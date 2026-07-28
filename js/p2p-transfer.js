/* =============================================================================
   p2p-transfer.js

   Direct device-to-device transfer of custom quizzes / stats. The actual
   payload NEVER touches Firestore or any server — only the brief
   connection handshake does, via one small, self-cleaning document per
   side (not "trickle ICE", to keep read/write counts low).
   ============================================================================= */

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]; // public STUN only, no paid TURN relay

// A signaling doc only ever needs to live for the ~2 minutes a transfer
// has to complete in. Anything older than this is orphaned — almost
// always because someone closed the tab mid-transfer, so the normal
// cleanup at the end of startSend()/startReceive() never got to run.
const SIGNALING_STALE_MS = 10 * 60 * 1000; // 10 min — generous margin over the 2 min transfer timeout

/**
 * Best-effort garbage collection for abandoned p2pSignaling docs. Runs
 * opportunistically at the start of every send/receive attempt, so the
 * collection self-cleans over normal use — no server-side job needed, and
 * it catches BOTH docs orphaned just now and ones that have been sitting
 * there from before this fix existed (their createdAt is a plain
 * timestamp regardless of when they were written, so the query below
 * finds all of them the same way). Never throws — a failed sweep should
 * never block an actual transfer.
 */
async function _sweepStaleSignalingDocs() {
  try {
    const cutoff = Date.now() - SIGNALING_STALE_MS;
    const staleQuery = window._query(
      window._collection(window._db, 'p2pSignaling'),
      window._where('createdAt', '<', cutoff)
    );
    const snap = await window._getDocs(staleQuery);
    await Promise.all(snap.docs.map(d => window._deleteDoc(d.ref).catch(() => {})));
  } catch (e) {
    console.warn('P2P signaling sweep skipped:', e);
  }
}

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
  _sweepStaleSignalingDocs(); // fire-and-forget, doesn't block this transfer

  const code = newTransferCode();
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const channel = pc.createDataChannel('transfer');
  let unsubscribe = () => {};

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    onStatus('waiting-for-receiver', code);
    await window._setDoc(window._doc(window._db, 'p2pSignaling', code), {
      offer: pc.localDescription.toJSON(),
      createdAt: Date.now()
    });

    // Real-time listener: pick up the answer the instant it's written, no polling.
    unsubscribe = window._onSnapshot(window._doc(window._db, 'p2pSignaling', code), async (snap) => {
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
  } finally {
    // Runs whether the transfer succeeded, failed, or threw \u2014 the
    // signaling doc must not outlive this function, or it's orphaned in
    // Firestore. (Can't help a hard tab close mid-transfer \u2014 nothing
    // client-side can \u2014 but that's what the sweep above is for.)
    unsubscribe();
    await window._deleteDoc(window._doc(window._db, 'p2pSignaling', code)).catch(() => {});
    pc.close();
  }
}

/**
 * Receiving side: given the code shown on the sender's device, connects
 * and returns the received payload.
 */
export async function startReceive(code, onStatus = () => {}) {
  _sweepStaleSignalingDocs(); // fire-and-forget, doesn't block this transfer

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

  // Second line of defense on top of the sender's own cleanup \u2014 once
  // this device has the payload, the signaling doc has served its
  // purpose no matter what happens to the sender next.
  await window._deleteDoc(window._doc(window._db, 'p2pSignaling', code)).catch(() => {});

  onStatus('done');
  pc.close();
  return payload;
}
