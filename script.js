const myIdDisplay = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const callBtn = document.getElementById('call-btn');
const videoGrid = document.getElementById('video-grid');
const localVideo = document.getElementById('local-video');

let localStream;
const connectedPeers = {}; // Track active connections to enforce the 3-person limit

// 1. Initialize PeerJS (Connects to free PeerJS Cloud Server automatically)
const peer = new Peer();

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
    } catch (err) {
        console.error("Failed to access camera/mic:", err);
        alert("Please allow camera access to run the prototype.");
    }
}

// 3. Handle Incoming Calls (Receiving a connection)
peer.on('call', (call) => {
    // Safety check: Reject if the call makes total participants > 3 (Us + 2 others)
    if (Object.keys(connectedPeers).length >= 2) {
        console.log("Room full. Rejecting call from:", call.peer);
        call.close();
        return;
    }

    call.answer(localStream); // Answer with our local camera stream
    handleCallStreams(call);
});

// 4. Initiate Outgoing Call (When clicking 'Connect Peer')
callBtn.addEventListener('click', () => {
    const remoteId = peerIdInput.value.trim();
    if (!remoteId) return;

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

    // Create a container block for this user's video feed
    const container = document.createElement('div');
    container.id = `container-${remotePeerId}`;
    
    const label = document.createElement('h3');
    label.innerText = `Peer: ${remotePeerId.substring(0, 5)}...`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true; // Crucial for iOS support

    container.appendChild(label);
    container.appendChild(video);

    // When the stream arrives, bind it to the video tag
    call.on('stream', (remoteStream) => {
        video.srcObject = remoteStream;
        videoGrid.appendChild(container);
    });

    // Cleanup if they hang up or lose signal
    call.on('close', () => {
        container.remove();
        delete connectedPeers[remotePeerId];
    });
}