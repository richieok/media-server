<script>
  import { onMount } from "svelte";
  import { formatTime, spriteSheetPath } from "$lib/format.js";

  export let src;
  export let item;
  export let base;
  export let autoplay = true;

  // Fixed by the sheet-generation script: 5x5 grid, 160x90 per frame, 25
  // frames evenly covering the whole video regardless of its length. That
  // last point is what lets the frame index come from cursor position alone
  // (hoverFraction * FRAME_COUNT), with no dependency on video duration.
  const SPRITE_COLS = 5;
  const SPRITE_ROWS = 5;
  const FRAME_W = 160;
  const FRAME_H = 90;
  const FRAME_COUNT = SPRITE_COLS * SPRITE_ROWS;

  // Percent-encode each path segment so filenames with spaces or other
  // special characters ("One more day-spritesh.jpg") survive both the HTTP
  // request and the CSS url() below.
  const spriteUrl =
    base + "/media/" + spriteSheetPath(item).split("/").map(encodeURIComponent).join("/");
  let spriteReady = false;
  const probe = new Image();
  probe.onload = () => (spriteReady = true);
  probe.onerror = () => {
    spriteReady = false;
    // Deliberate degradation (no thumbnail, seeking still works), but say
    // so in the console — a naming mismatch looks identical to a missing
    // sheet, and this is the only place the attempted URL is visible.
    console.warn(`No scrub-preview sprite sheet at ${spriteUrl}`);
  };
  probe.src = spriteUrl;

  let wrapperEl;
  let videoEl;
  let barEl;

  let playing = false;
  let currentTime = 0;
  let duration = 0;
  let muted = false;
  let volume = 1;

  let dragging = false;
  let hovering = false;
  let hoverFraction = 0;
  let previewLeft = 0;
  let lastSeekAt = 0;
  const SEEK_THROTTLE_MS = 120;

  $: progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  $: previewVisible = spriteReady && (hovering || dragging);
  $: previewFrame = Math.min(FRAME_COUNT - 1, Math.max(0, Math.floor(hoverFraction * FRAME_COUNT)));
  $: previewCol = previewFrame % SPRITE_COLS;
  $: previewRow = Math.floor(previewFrame / SPRITE_COLS);
  $: previewTime = hoverFraction * duration;

  onMount(() => wrapperEl.focus());

  function togglePlay() {
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  }

  function toggleMute() {
    videoEl.muted = !videoEl.muted;
  }

  function onVolumeInput(event) {
    const value = Number(event.target.value);
    videoEl.volume = value;
    videoEl.muted = value === 0;
  }

  // Single rect read shared by both the seek fraction and the thumbnail's
  // horizontal position, so the two never disagree from stale measurements.
  function updateHover(event) {
    const rect = barEl.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    hoverFraction = rect.width > 0 ? x / rect.width : 0;
    previewLeft = Math.min(Math.max(x - FRAME_W / 2, 0), Math.max(rect.width - FRAME_W, 0));
  }

  // Throttled during a drag so continuous pointer movement doesn't fire a
  // new Range request to the API on every pixel — the thumbnail and fill
  // bar still update every frame, only the actual network seek is limited.
  function commitSeek({ throttle = false } = {}) {
    if (!duration) return;
    if (throttle) {
      const now = performance.now();
      if (now - lastSeekAt < SEEK_THROTTLE_MS) return;
      lastSeekAt = now;
    }
    videoEl.currentTime = hoverFraction * duration;
  }

  function onPointerEnter(event) {
    hovering = true;
    updateHover(event);
  }

  function onPointerLeave() {
    hovering = false;
  }

  function onPointerMove(event) {
    updateHover(event);
    if (dragging) {
      currentTime = hoverFraction * duration;
      commitSeek({ throttle: true });
    }
  }

  function onPointerDown(event) {
    dragging = true;
    barEl.setPointerCapture(event.pointerId);
    updateHover(event);
    currentTime = hoverFraction * duration;
    commitSeek();
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    updateHover(event);
    commitSeek();
    barEl.releasePointerCapture(event.pointerId);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === wrapperEl) {
      document.exitFullscreen();
    } else {
      wrapperEl.requestFullscreen();
    }
  }

  function onKeydown(event) {
    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
        break;
      case "ArrowRight":
        videoEl.currentTime = Math.min(duration, videoEl.currentTime + 5);
        break;
      case "m":
        toggleMute();
        break;
      case "f":
        toggleFullscreen();
        break;
    }
  }
</script>

<div class="video-player" bind:this={wrapperEl} tabindex="0" on:keydown={onKeydown}>
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    bind:this={videoEl}
    {src}
    {autoplay}
    playsinline
    on:click={togglePlay}
    on:play={() => (playing = true)}
    on:pause={() => (playing = false)}
    on:loadedmetadata={() => (duration = videoEl.duration)}
    on:timeupdate={() => {
      if (!dragging) currentTime = videoEl.currentTime;
    }}
    on:volumechange={() => {
      muted = videoEl.muted;
      volume = videoEl.volume;
    }}
  ></video>

  <div class="controls">
    <button class="icon-btn" type="button" on:click={togglePlay} aria-label={playing ? "Pause" : "Play"}>
      {playing ? "⏸" : "▶"}
    </button>

    <div
      class="seek"
      bind:this={barEl}
      on:pointerenter={onPointerEnter}
      on:pointerleave={onPointerLeave}
      on:pointermove={onPointerMove}
      on:pointerdown={onPointerDown}
      on:pointerup={onPointerUp}
      on:pointercancel={onPointerUp}
    >
      <div class="seek-track">
        <div class="seek-fill" style="width: {progressPct}%"></div>
      </div>

      {#if previewVisible}
        <div class="preview" style="left: {previewLeft}px">
          <div
            class="preview-thumb"
            style="background-image: url('{spriteUrl}'); background-position: -{previewCol *
              FRAME_W}px -{previewRow * FRAME_H}px"
          ></div>
          <div class="preview-time">{formatTime(previewTime)}</div>
        </div>
      {/if}
    </div>

    <span class="time">{formatTime(currentTime)} / {formatTime(duration)}</span>

    <button class="icon-btn" type="button" on:click={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
      {muted || volume === 0 ? "🔇" : "🔊"}
    </button>
    <input
      class="volume"
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={volume}
      on:input={onVolumeInput}
      aria-label="Volume"
    />

    <button class="icon-btn" type="button" on:click={toggleFullscreen} aria-label="Fullscreen">⛶</button>
  </div>
</div>

<style>
  .video-player {
    display: flex;
    flex-direction: column;
    max-height: 70vh;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
  }

  .video-player:focus {
    outline: none;
  }

  .video-player:fullscreen {
    max-height: 100vh;
    border-radius: 0;
  }

  video {
    display: block;
    width: 100%;
    flex: 1;
    min-height: 0;
    object-fit: contain;
    background: #000;
    cursor: pointer;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    background: var(--surface);
  }

  .icon-btn {
    flex: none;
    background: none;
    border: none;
    color: var(--text);
    font-size: 1rem;
    line-height: 1;
    padding: 0.3rem;
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--accent);
  }

  .seek {
    position: relative;
    flex: 1;
    height: 24px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .seek-track {
    position: relative;
    width: 100%;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .seek-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: var(--accent);
  }

  .preview {
    position: absolute;
    bottom: 100%;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    pointer-events: none;
  }

  .preview-thumb {
    width: 160px;
    height: 90px;
    background-repeat: no-repeat;
    background-color: #000;
    border: 2px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  .preview-time {
    font-size: 0.7rem;
    color: #fff;
    background: rgba(0, 0, 0, 0.85);
    padding: 2px 6px;
    border-radius: 3px;
  }

  .time {
    flex: none;
    font-size: 0.75rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .volume {
    flex: none;
    width: 70px;
    accent-color: var(--accent);
  }

  @media (max-width: 30rem) {
    .volume {
      display: none;
    }
  }
</style>
