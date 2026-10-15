// Voice chat between the players of a session.
//
// The audio goes from browser to browser with WebRTC, one connection for each
// other player of the voice channel (a full mesh: fine for the few players of
// a table). Tourtoirac only relays the messages the browsers need to find each
// other (voice_signal) and says who is in the channel (voice_members).
//
// Who calls whom: the newcomer calls every player already there (the peers of
// voice_joined); the others wait for its offer. The server handles the joins
// one at a time, so two players never call each other.

import type { VoiceJoinedEvent, VoiceSignalData } from "./types";

// level (RMS of the signal, 0..1) above which a player is shown speaking
const SPEAKING_LEVEL = 0.02;
const SPEAKING_POLL_MS = 150;

export interface VoiceHost {
  /** sends an action to Tourtoirac */
  send(message: Record<string, unknown>): void;
  /** the members, who speaks, or the state of the reader changed */
  onChange(): void;
}

interface Peer {
  connection: RTCPeerConnection;
  // the newcomer, who sends the offer, and restarts it when the link fails
  caller: boolean;
  audio: HTMLAudioElement | null;
  // ICE candidates received before the description they belong to
  pendingCandidates: RTCIceCandidateInit[];
}

export class VoiceChat {
  /** whether the reader is in the voice channel */
  joined = false;
  /** whether the reader's microphone is cut */
  muted = false;
  /** the nicknames of the players in the voice channel, by the server */
  members: string[] = [];
  /** the nicknames of the players heard speaking right now */
  readonly speaking = new Set<string>();

  private localStream: MediaStream | null = null;
  private readonly peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] = [];
  private audioContext: AudioContext | null = null;
  private readonly meters = new Map<string, AnalyserNode>();
  private meterTimer: number | null = null;

  constructor(
    private readonly host: VoiceHost,
    private readonly myName: () => string | undefined,
  ) {}

  /** The browser can only reach the microphone in a secure context. */
  static available(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Opens the microphone and enters the channel. Rejects when the player
   * refuses the microphone, or when there is none.
   */
  async join(): Promise<void> {
    if (this.joined) return;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.applyMute();
    // created on the click that joins: the browser lets it play
    this.audioContext = new AudioContext();
    const me = this.myName();
    if (me) this.watchLevel(me, this.localStream);
    this.meterTimer = window.setInterval(() => this.pollLevels(), SPEAKING_POLL_MS);
    this.joined = true;
    this.host.send({ action: "voice_join" });
    this.host.onChange();
  }

  /** Hangs up on everybody and closes the microphone. */
  leave(): void {
    if (!this.joined) return;
    this.host.send({ action: "voice_leave" });
    this.teardown();
    this.host.onChange();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyMute();
    this.host.onChange();
  }

  /**
   * After a reconnection the server knows a new connection, outside the
   * channel: the reader calls the others again.
   */
  rejoin(): void {
    if (!this.joined) return;
    for (const name of [...this.peers.keys()]) this.closePeer(name);
    this.host.send({ action: "voice_join" });
  }

  /** voice_joined: the reader calls each player already in the channel. */
  onJoined(message: VoiceJoinedEvent): void {
    if (!this.joined) return;
    this.iceServers = Array.isArray(message.ice_servers) ? message.ice_servers : [];
    for (const name of message.peers ?? []) {
      this.closePeer(name);
      void this.call(name);
    }
  }

  /** voice_members, or the voice list of the session. */
  setMembers(members: string[] | undefined): void {
    this.members = Array.isArray(members) ? members : [];
    // whoever left the channel is hung up on
    for (const name of [...this.peers.keys()]) {
      if (!this.members.includes(name)) this.closePeer(name);
    }
    for (const name of [...this.speaking]) {
      if (!this.members.includes(name)) this.speaking.delete(name);
    }
    this.host.onChange();
  }

  /** voice_signal: an offer, an answer or an ICE candidate of another player. */
  async onSignal(from: string, data: VoiceSignalData): Promise<void> {
    if (!this.joined || !from) return;
    let peer = this.peers.get(from);
    try {
      if (data.description) {
        if (data.description.type === "offer") {
          // a new call, or the same caller starting again
          if (peer) this.closePeer(from);
          peer = this.createPeer(from, false);
        }
        if (!peer) return;
        await peer.connection.setRemoteDescription(data.description);
        for (const candidate of peer.pendingCandidates.splice(0)) {
          await peer.connection.addIceCandidate(candidate);
        }
        if (data.description.type === "offer") {
          await peer.connection.setLocalDescription(await peer.connection.createAnswer());
          this.signal(from, { description: peer.connection.localDescription?.toJSON() });
        }
      } else if (data.candidate && peer) {
        if (peer.connection.remoteDescription) {
          await peer.connection.addIceCandidate(data.candidate);
        } else {
          peer.pendingCandidates.push(data.candidate);
        }
      }
    } catch (error) {
      console.warn("[voice] Signal refusé de", from, error);
    }
  }

  private async call(name: string): Promise<void> {
    const peer = this.createPeer(name, true);
    try {
      await peer.connection.setLocalDescription(await peer.connection.createOffer());
      this.signal(name, { description: peer.connection.localDescription?.toJSON() });
    } catch (error) {
      console.warn("[voice] Appel impossible vers", name, error);
    }
  }

  private createPeer(name: string, caller: boolean): Peer {
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { connection, caller, audio: null, pendingCandidates: [] };
    this.peers.set(name, peer);

    for (const track of this.localStream?.getTracks() ?? []) {
      connection.addTrack(track, this.localStream as MediaStream);
    }
    connection.onicecandidate = (event) => {
      if (event.candidate) this.signal(name, { candidate: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (!peer.audio) {
        peer.audio = new Audio();
        peer.audio.autoplay = true;
      }
      peer.audio.srcObject = stream;
      void peer.audio.play().catch(() => undefined);
      this.watchLevel(name, stream);
    };
    connection.onconnectionstatechange = () => {
      // the caller tries again once when the link is lost: a new network
      // path may exist (Wi-Fi to 4G, a TURN relay)
      if (connection.connectionState === "failed" && peer.caller && this.peers.get(name) === peer) {
        connection.restartIce();
        void connection
          .createOffer({ iceRestart: true })
          .then((offer) => connection.setLocalDescription(offer))
          .then(() => this.signal(name, { description: connection.localDescription?.toJSON() }))
          .catch((error) => console.warn("[voice] Relance impossible vers", name, error));
      }
    };
    return peer;
  }

  private signal(to: string, data: VoiceSignalData): void {
    this.host.send({ action: "voice_signal", to, data });
  }

  private closePeer(name: string): void {
    const peer = this.peers.get(name);
    if (!peer) return;
    this.peers.delete(name);
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.close();
    if (peer.audio) {
      peer.audio.pause();
      peer.audio.srcObject = null;
    }
    this.meters.delete(name);
    this.speaking.delete(name);
  }

  private teardown(): void {
    for (const name of [...this.peers.keys()]) this.closePeer(name);
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    if (this.meterTimer !== null) window.clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.meters.clear();
    this.speaking.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.joined = false;
    this.muted = false;
  }

  private applyMute(): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !this.muted;
  }

  // Each stream feeds an analyser, read every SPEAKING_POLL_MS: it is only
  // measured, the sound itself is played by the audio element.
  private watchLevel(name: string, stream: MediaStream): void {
    if (!this.audioContext) return;
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.audioContext.createMediaStreamSource(stream).connect(analyser);
    this.meters.set(name, analyser);
  }

  private pollLevels(): void {
    let changed = false;
    const samples = new Uint8Array(512);
    const me = this.myName();
    for (const [name, analyser] of this.meters) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }
      // a muted microphone sends silence, but the reader still hears itself
      // in the analyser: it is never shown speaking while muted
      const speaks = Math.sqrt(sum / samples.length) > SPEAKING_LEVEL && !(name === me && this.muted);
      if (speaks !== this.speaking.has(name)) {
        changed = true;
        if (speaks) this.speaking.add(name);
        else this.speaking.delete(name);
      }
    }
    if (changed) this.host.onChange();
  }
}
