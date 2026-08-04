<script>
  let { children } = $props();
</script>

{@render children()}

<style>
  :global(:root) {
    --bg: #0e1116;
    --surface: #161b22;
    --surface-hover: #1f262f;
    --border: #2a323d;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --accent: #4c9aff;
    color-scheme: dark;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family:
      ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
</style>
