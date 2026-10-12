const myIdDisplay = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const callBtn = document.getElementById('call-btn');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');

// On-screen log so problems can be read on a phone without devtools
const debugEl = document.getElementById('debug');
function dbg(msg) {
    console.log(msg);
    if (debugEl) {
        debugEl.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    }
}
dbg(`Page: ${location.href}`);
dbg(`Secure context (HTTPS/localhost): ${window.isSecureContext}`);
dbg(`Camera API available: ${!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)}`);

let localStream;
const connectedPeers = {}; // Track active connections to enforce the 3-person limit

// 1. Initialize PeerJS (Connects to free PeerJS Cloud Server automatically)

// const peer = new Peer(undefined, {
//     config: {
//         iceServers: [
//             // {
//             //     urls: 'turn:8.211.6.233:3478',
//             //     username: 'test',
//             //     credential: 'test'
//             // },
//             {
//                 urls: 'turn:8.211.6.233:443?transport=tcp', 
//                 username: 'test',
//                 credential: 'test'
//             }       
//         ],
//         iceTransportPolicy: 'relay'
//     }
// });
const peer = new Peer();

peer.on('error', (err) => console.error('Peer error:', err));
peer.on('disconnected', () => console.warn('Peer disconnected'));
peer.on('close', () => console.warn('Peer connection closed'));

// Display your assigned random ID once connected
peer.on('open', async (id) => {
    myIdDisplay.innerText = id;
    await initLocalVideo();
});

// 2. Access the webcam and microphone
let localStreamPromise = null;

function initLocalVideo() {
    // Make sure concurrent callers share one getUserMedia request
    if (!localStreamPromise) localStreamPromise = acquireLocalStream();
    return localStreamPromise;
}

// Black canvas stream used when no camera is available. A WebRTC call needs at least
// one track, otherwise the connection negotiates with no media and nothing is received.
function createPlaceholderStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const draw = () => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#888';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No camera', canvas.width / 2, canvas.height / 2);
    };
    draw();
    setInterval(draw, 1000); // keep producing frames
    return canvas.captureStream(5);
}

async function acquireLocalStream() {
    let stream = null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // Happens on phones when the page is opened over plain http://<LAN-IP>
        console.error('navigator.mediaDevices is unavailable. isSecureContext =', window.isSecureContext);
        alert(
            "Camera/mic are blocked because this page isn't served over HTTPS.\n\n" +
            "Open the page through an https:// URL (e.g. an ngrok / cloudflared tunnel) " +
            "instead of http://<ip>:<port>.\n\n" +
            "You'll still be able to see other people, but they won't see you."
        );
    } else {
        // Try progressively simpler constraints (some phones reject specific sizes/devices)
        const attempts = [
            { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: true },
            { video: true, audio: true },
            { video: true, audio: false },
            { video: false, audio: true }
        ];
        for (const constraints of attempts) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                break;
            } catch (err) {
                console.warn('getUserMedia failed with', JSON.stringify(constraints), err.name, err.message);
            }
        }
        if (!stream) {
            alert("Could not access the camera/mic. Check the browser's site permissions and that no other app is using the camera.");
        }
    }

    if (stream) {
        // If we only got audio, add a placeholder video track so the peer still gets a video m-line
        if (stream.getVideoTracks().length === 0) {
            createPlaceholderStream().getVideoTracks().forEach((t) => stream.addTrack(t));
        }
    } else {
        stream = createPlaceholderStream();
    }

    localStream = stream;
    dbg(`Local stream: ${stream.getVideoTracks().length} video track(s), ${stream.getAudioTracks().length} audio track(s)`);
    localVideo.srcObject = localStream;
    // Mute local preview to allow autoplay and avoid echo on mobile
    localVideo.muted = true;
    localVideo.playsInline = true;
    localVideo.autoplay = true;
    localVideo.play().catch(() => {});
    return localStream;
}

// 3. Handle Incoming Calls (Receiving a connection)
peer.on('call', async (call) => {
    // Safety check: Reject if the call makes total participants > 3 (Us + 2 others)
    if (Object.keys(connectedPeers).length >= 2) {
        console.log("Room full. Rejecting call from:", call.peer);
        call.close();
        return;
    }

    if (!localStream) {
        await initLocalVideo();
    }

    call.answer(localStream); // Answer with our local camera stream (or placeholder)
    handleCallStreams(call);
});

// 4. Initiate Outgoing Call (When clicking 'Connect Peer')
callBtn.addEventListener('click', async () => {
    const remoteId = peerIdInput.value.trim();
    if (!remoteId) return;

    if (!localStream) {
        await initLocalVideo();
    }

    if (Object.keys(connectedPeers).length >= 2) {
        alert("You are already connected to 2 people!");
        return;
    }

    if (connectedPeers[remoteId]) {
        alert("Already connected to this user.");
        return;
    }

    const call = peer.call(remoteId, localStream);
    handleCallStreams(call);
    peerIdInput.value = '';
});

// 5. Shared logic to inject streams into DOM layout
function handleCallStreams(call) {
    const remotePeerId = call.peer;
    connectedPeers[remotePeerId] = call;
    dbg(`Call set up with ${remotePeerId.substring(0,5)}... (waiting for their stream)`);

    // Attach detailed ICE / connection state logging
    try {
        const pc = call.peerConnection || call._pc || (call.connection && call.connection.peerConnection);
        if (pc) {
            // ICE candidate logging.
            // IMPORTANT: use addEventListener, NOT `pc.onicecandidate = ...`.
            // PeerJS sets onicecandidate internally to send candidates to the other peer;
            // overwriting it breaks the connection (peer appears, but no media flows).
            pc.addEventListener('icecandidate', (event) => {
                if (event.candidate) {
                    console.log(`[ICE Candidate] Type: ${event.candidate.type}, Protocol: ${event.candidate.protocol}, Address: ${event.candidate.address}`);
                } else {
                    console.log('[ICE Candidate] Gathering complete.');
                }
            });

            // ICE connection state listener
            pc.addEventListener('iceconnectionstatechange', () => {
                const state = pc.iceConnectionState;
                dbg(`[ICE State] ${remotePeerId.substring(0,5)}... -> ${state}`);
                
                if (state === 'failed') {
                    console.warn('ICE Failed! Check if TURN server is reachable or credentials are correct.');
                }
            });

            // Listen for changes in the connection state
            pc.addEventListener('connectionstatechange', () => {
                console.log(`[PC Connection State] Peer: ${remotePeerId.substring(0,5)}... -> ${pc.connectionState}`);
            });
        }
    } catch (e) {
        console.warn('Could not attach peerConnection listeners for', remotePeerId, e);
    }

    // Create a container block for this user's video feed
    const container = document.createElement('div');
    container.id = `container-${remotePeerId}`;
    
    const label = document.createElement('h3');
    label.innerText = `Peer: ${remotePeerId.substring(0, 5)}...`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true; // Crucial for iOS support
    video.muted = false;

    container.appendChild(label);
    container.appendChild(video);
    videoGrid.appendChild(container);

    // When the stream arrives, bind it to the video tag
    call.on('stream', (remoteStream) => {
        dbg(`Received remote stream from ${remotePeerId.substring(0,5)}...: ${remoteStream.getVideoTracks().length} video, ${remoteStream.getAudioTracks().length} audio track(s)`);
        video.srcObject = remoteStream;
        video.onloadedmetadata = async () => {
            try {
                await video.play();
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    // benign race where a new load interrupted play; ignore
                    console.debug('play() aborted due to load race for', remotePeerId);
                } else {
                    // Mobile browsers block autoplay with sound: retry muted, tap to unmute
                    console.warn('Remote autoplay with audio blocked, retrying muted.', err);
                    video.muted = true;
                    video.play().catch((e) => console.warn('Muted play failed too', e));
                    video.onclick = () => { video.muted = false; video.play(); };
                }
            }
        };
    });

    // Cleanup if they hang up or lose signal
    call.on('close', () => {
        container.remove();
        delete connectedPeers[remotePeerId];
    });
    call.on('error', (err) => {
        console.error('Call error with', remotePeerId, err);
        if (container.parentNode) container.parentNode.removeChild(container);
        delete connectedPeers[remotePeerId];
    });
}