const myIdDisplay = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const callBtn = document.getElementById('call-btn');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');

let localStream;
const connectedPeers = {}; // Track active connections to enforce the 3-person limit

// 1. Initialize PeerJS (Connects to free PeerJS Cloud Server automatically)
const peer = new Peer(undefined, {
    config: {
        iceServers: [
            {
                urls: 'turn:8.211.6.233:3478',
                username: 'test',
                credential: 'test'
            },
            {
                urls: 'turn:8.211.6.233:5349?transport=tcp', 
                username: 'test',
                credential: 'test'
            }       

        ]
    }
});

peer.on('error', (err) => console.error('Peer error:', err));
peer.on('disconnected', () => console.warn('Peer disconnected'));
peer.on('close', () => console.warn('Peer connection closed'));

// Display your assigned random ID once connected
peer.on('open', (id) => {
    myIdDisplay.innerText = id;
    initLocalVideo();
});

// 2. Access the webcam and microphone
async function initLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: 640, height: 480 }, // Phone optimized parameters
            audio: true
        });
        localVideo.srcObject = localStream;
        // Mute local preview to allow autoplay and avoid echo on mobile
        localVideo.muted = true;
        localVideo.playsInline = true;
        localVideo.autoplay = true;
    } catch (err) {
        console.error("Failed to access camera/mic:", err);
        alert("Please allow camera access to run the prototype.");
    }
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

    call.answer(localStream); // Answer with our local camera stream
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
    console.log('Handling call streams for', remotePeerId);

    // Attach detailed ICE / connection state logging
    try {
        const pc = call.peerConnection || call._pc || (call.connection && call.connection.peerConnection);
        if (pc) {
            // ICE backup server listenr
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log(`[ICE Candidate] Type: ${event.candidate.type}, Protocol: ${event.candidate.protocol}, Address: ${event.candidate.address}`);
                } else {
                    console.log('[ICE Candidate] Gathering complete.');
                }
            };

            // ICE connection state listener
            pc.addEventListener('iceconnectionstatechange', () => {
                const state = pc.iceConnectionState;
                console.log(`[ICE State Change] Peer: ${remotePeerId.substring(0,5)}... -> ${state}`);
                
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
    // Start muted to satisfy mobile autoplay policies. User can tap to unmute.
    video.muted = true;

    container.appendChild(label);
    container.appendChild(video);
    videoGrid.appendChild(container);

    // When the stream arrives, bind it to the video tag
    call.on('stream', async (remoteStream) => {
        console.log('Received remote stream event from', remotePeerId);
        video.srcObject = remoteStream;
        video.onloadedmetadata = async () => {
            try {
                await video.play();
            } catch (err) {
                if (err && err.name === 'AbortError') {
                    // benign race where a new load interrupted play; ignore
                    console.debug('play() aborted due to load race for', remotePeerId);
                } else {
                    console.warn('Remote video autoplay blocked, user interaction may be required.', err);
                }
            }
        };

        // Mobile hint & tap-to-unmute
        const hint = document.createElement('div');
        hint.innerText = 'Tap to enable audio';
        hint.style.cssText = 'position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;padding:6px;border-radius:4px;font-size:12px;';
        container.style.position = 'relative';
        container.appendChild(hint);
        const removeHint = () => { if (hint.parentNode) hint.parentNode.removeChild(hint); };
        const onTap = async () => {
            try {
                video.muted = false;
                await video.play();
            } catch (e) {
                console.warn('Failed to unmute/play after user gesture', e);
            }
            removeHint();
            container.removeEventListener('click', onTap);
        };
        container.addEventListener('click', onTap);
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