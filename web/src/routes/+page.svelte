<script>
  import { formatSize, kindOf, ICONS, breadcrumbs } from "$lib/format.js";
  import VideoPlayer from "$lib/VideoPlayer.svelte";

  export let data;

  let playing = null;

  $: crumbs = breadcrumbs(data.dir);
  $: base = data.mediaBase;
  $: parentDir = data.dir.split("/").slice(0, -1).join("/");

  function hrefFor(dir) {
    return dir ? `/?dir=${encodeURIComponent(dir)}` : "/";
  }

  function open(item) {
    playing = item;
  }

  function close() {
    playing = null;
  }

  function onKeydown(event) {
    if (event.key === "Escape") close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<svelte:head>
  <title>{data.dir ? `${data.dir} · Media Library` : "Media Library"}</title>
</svelte:head>

<header>
  <h1>Media Library</h1>
  <nav aria-label="Breadcrumb">
    <a href="/" class:current={crumbs.length === 0}>Home</a>
    {#each crumbs as crumb, i}
      <span class="sep" aria-hidden="true">/</span>
      <a href={hrefFor(crumb.path)} class:current={i === crumbs.length - 1}>
        {crumb.name}
      </a>
    {/each}
  </nav>
</header>

<main>
  {#if data.loadError}
    <p class="notice error">{data.loadError}</p>
  {:else if data.items.length === 0}
    <p class="notice">This folder is empty.</p>
  {:else}
    <ul class="items">
      {#if data.dir}
        <li>
          <a class="row" href={hrefFor(parentDir)}>
            <span class="icon" aria-hidden="true">↩︎</span>
            <span class="name">Up one level</span>
          </a>
        </li>
      {/if}

      {#each data.items as item (item.path)}
        {@const kind = kindOf(item)}
        <li>
          {#if kind === "directory"}
            <a class="row" href={hrefFor(item.path)}>
              <span class="icon" aria-hidden="true">{ICONS.directory}</span>
              <span class="name">{item.name}</span>
              <span class="meta">folder</span>
            </a>
          {:else if kind === "file"}
            <a class="row" href={base + item.url} download={item.name}>
              <span class="icon" aria-hidden="true">{item.encrypted ? "🔒 " : ""}{ICONS.file}</span>
              <span class="name">{item.name}</span>
              <span class="meta">{formatSize(item.size)} · download</span>
            </a>
          {:else}
            <button class="row" type="button" on:click={() => open(item)}>
              <span class="icon" aria-hidden="true">{item.encrypted ? "🔒 " : ""}{ICONS[kind]}</span>
              <span class="name">{item.name}</span>
              <span class="meta">{formatSize(item.size)}</span>
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if playing}
  {@const kind = kindOf(playing)}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label={playing.name}
    on:click={close}
  >
    <div class="player" on:click|stopPropagation>
      <div class="player-bar">
        <span class="player-name">{playing.name}</span>
        <button class="close" type="button" on:click={close} aria-label="Close">
          ✕
        </button>
      </div>

      {#if kind === "video"}
        <VideoPlayer src={base + playing.url} item={playing} {base} />
      {:else if kind === "audio"}
        <audio src={base + playing.url} controls autoplay></audio>
      {:else}
        <img src={base + playing.url} alt={playing.name} />
      {/if}

      <a class="direct" href={base + playing.url} download={playing.name}>
        Download original
      </a>
    </div>
  </div>
{/if}

<style>
  header {
    padding: 1.5rem 1.25rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  nav {
    font-size: 0.875rem;
    color: var(--text-dim);
    word-break: break-word;
  }

  nav a {
    color: var(--accent);
    text-decoration: none;
  }

  nav a:hover {
    text-decoration: underline;
  }

  nav a.current {
    color: var(--text-dim);
    pointer-events: none;
  }

  .sep {
    margin: 0 0.4rem;
    color: var(--border);
  }

  main {
    max-width: 60rem;
    margin: 0 auto;
    padding: 1rem 1.25rem 4rem;
  }

  .notice {
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }

  .notice.error {
    border-color: #5c2b2b;
    color: #ff9c9c;
  }

  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.7rem 0.85rem;
    background: var(--surface);
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface-hover);
    border-color: var(--border);
  }

  .icon {
    flex: none;
    font-size: 1.1rem;
    line-height: 1;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .meta {
    flex: none;
    color: var(--text-dim);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .player {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.75rem;
    width: min(60rem, 100%);
    max-height: 100%;
    overflow: auto;
  }

  .player-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.6rem;
  }

  .player-name {
    flex: 1;
    min-width: 0;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  .close {
    flex: none;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 1rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
  }

  .close:hover {
    color: var(--text);
  }

  img {
    display: block;
    width: 100%;
    max-height: 70vh;
    object-fit: contain;
    background: #000;
    border-radius: 6px;
  }

  audio {
    width: 100%;
  }

  .direct {
    display: inline-block;
    margin-top: 0.6rem;
    color: var(--accent);
    font-size: 0.85rem;
    text-decoration: none;
  }

  .direct:hover {
    text-decoration: underline;
  }

  @media (max-width: 30rem) {
    .meta {
      display: none;
    }
  }
</style>
