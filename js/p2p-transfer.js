/* =============================================================================
   p2p-transfer.js

   Direct device-to-device transfer of custom quizzes / stats. The actual
   payload NEVER touches Firestore or any server — only the brief
   connection handshake does, via one small, self-cleaning document per
   side (not "trickle ICE", to keep read/write counts low).
   ============================================================================= */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]; // public STUN only, no paid TURN relay

function newTransferCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Waits until ICE gathering finishes, so we can send ONE combined signaling document instead of trickling candidates one at a time. */
function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve();
    });
  });
}

/**
 * Sending side: creates an offer, writes ONE signaling document, waits for
 * the answer, then streams the payload once connected. The generated code
 * is passed as the 2nd argument to onStatus alongside the
 * 'waiting-for-receiver' status, so the caller can display it — it must be
 * shown to the user, since it's the only thing that identifies this
 * transfer to the receiving device (read aloud, typed, etc.).
 */
export async function startSend(payload, onStatus = () => {}) {
  const code = newTransferCode();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel('transfer');

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  onStatus('waiting-for-receiver', code);
  await window._setDoc(window._doc(window._db, 'p2pSignaling', code), {
    offer: pc.localDescription.toJSON(),
    createdAt: Date.now()
  });

  // Real-time listener: pick up the answer the instant it's written, no polling.
  const unsubscribe = window._onSnapshot(window._doc(window._db, 'p2pSignaling', code), async (snap) => {
    const data = snap.data();
    if (data && data.answer && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(data.answer);
    }
  });

  await new Promise((resolve, reject) => {
    channel.onopen = async () => {
      onStatus('connected');
      channel.send(JSON.stringify(payload));
      channel.onmessage = (e) => {
        if (e.data === 'ack') {
          onStatus('done');
          resolve();
        }
      };
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') reject(new Error('Connection failed \u2014 use manual export/import instead.'));
    };
    setTimeout(() => reject(new Error('Timed out waiting for the other device.')), 2 * 60 * 1000);
  });

  unsubscribe();
  await window._deleteDoc(window._doc(window._db, 'p2pSignaling', code)).catch(() => {});
  pc.close();
}

/**
 * Receiving side: given the code shown on the sender's device, connects
 * and returns the received payload.
 */
export async function startReceive(code, onStatus = () => {}) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  onStatus('looking-for-sender');
  const offerSnap = await window._getDoc(window._doc(window._db, 'p2pSignaling', code));
  if (!offerSnap.exists() || !offerSnap.data().offer) {
    throw new Error('No transfer found with that code \u2014 check it and try again.');
  }

  // Attach the data-channel listener BEFORE the connection can possibly
  // open, so we never miss the event.
  const dataPromise = new Promise((resolve, reject) => {
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      channel.onmessage = (e) => {
        const data = JSON.parse(e.data);
        channel.send('ack');
        resolve(data);
      };
    };
    setTimeout(() => reject(new Error('Timed out waiting for data.')), 2 * 60 * 1000);
  });

  await pc.setRemoteDescription(offerSnap.data().offer);

  // The answer MUST be created and sent back to the sender before a
  // connection (and therefore any data) can arrive \u2014 do this first,
  // not after waiting for data, or the two sides deadlock waiting on
  // each other.
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);
  onStatus('connecting');
  await window._setDoc(window._doc(window._db, 'p2pSignaling', code), {
    answer: pc.localDescription.toJSON()
  }, { merge: true });

  const payload = await dataPromise;

  onStatus('done');
  pc.close();
  return payload;
}
