(function () {
  const API_ROOT = 'https://itstiers.vercel.app/api/v2';
  const MODES = ['overall', 'ltm', 'vanilla', 'uhc', 'pot', 'nethop', 'smp', 'sword', 'axe', 'mace'];
  const MODE_LABELS = {
    ltm: 'LTMs',
    vanilla: 'Vanilla',
    uhc: 'UHC',
    pot: 'Pot',
    nethop: 'NethOP',
    smp: 'SMP',
    sword: 'Sword',
    axe: 'Axe',
    mace: 'Mace',
    overall: 'Overall'
  };

  function modeFromPath() {
    const parts = window.location.pathname.toLowerCase().split('/').filter(Boolean);
    const last = parts[parts.length - 1] || 'overall';
    return MODES.includes(last) ? last : 'overall';
  }

  function pointsFor(ranking) {
    if (!ranking) return 0;
    const table = {
      1: [60, 45],
      2: [30, 20],
      3: [10, 6],
      4: [4, 3],
      5: [2, 1]
    };
    return table[ranking.tier]?.[ranking.pos] || 0;
  }

  function titleFor(points) {
    if (points >= 400) return 'Combat Grandmaster';
    if (points >= 250) return 'Combat Master';
    if (points >= 100) return 'Combat Ace';
    if (points >= 50) return 'Combat Specialist';
    if (points >= 20) return 'Combat Cadet';
    if (points >= 10) return 'Combat Novice';
    if (points >= 1) return 'Combat Rookie';
    return 'Unranked';
  }

  function skinUrl(player) {
    return player.skin_render_url || `https://render.crafty.gg/3d/bust/${encodeURIComponent(player.username || player.name || player.uuid)}`;
  }

  function slot(mode, ranking) {
    const empty = !ranking;
    const icon = empty ? '' : `<img src="/tier_icons/${mode}.svg" width="20" height="20" class="object-contain" alt="${mode}">`;
    const label = empty ? '-' : `${ranking.pos === 0 ? 'HT' : 'LT'}${ranking.tier}`;
    const title = empty ? '' : `${MODE_LABELS[mode] || mode}: ${label} (${pointsFor(ranking)} points)`;

    return `
      <span class="w-10 h-14 flex flex-col items-center relative" title="${title}">
        <span class="size-8 ${empty ? 'bg-black/20 border-slate-500/50 border-dashed' : 'bg-black/50 border-slate-500'} rounded-full flex items-center justify-center overflow-clip border-2 p-1">
          ${icon}
        </span>
        <strong class="absolute bottom-0.5 left-2/4 -translate-x-2/4 text-[14px] px-1 rounded-lg w-9 h-6 text-center ${empty ? 'bg-slate-500/10 text-muted-foreground' : 'bg-slate-700 text-slate-200'}">${label}</strong>
      </span>
    `;
  }

  function overallRow(player, index) {
    const rank = index + 1;
    const modes = ['mace', 'sword', 'axe', 'pot', 'uhc', 'smp', 'vanilla', 'nethop'];

    return `
      <div class="itstiers-fallback-row w-full h-20 relative duration-150 sm:hover:-translate-x-4 sm:active:scale-[.99] max-md:h-fit flex flex-col bg-accent/20 hover:bg-accent rounded-xl my-2 border-2 border-border" role="button">
        <div class="w-full flex gap-2 items-center h-[inherit] max-md:flex-col">
          <div class="w-full h-[inherit] flex gap-2 items-center">
            <div class="max-w-40 w-full h-14 flex items-center p-2 relative overflow-clip rounded-xs">
              <img src="/placements/${rank >= 4 ? 'other.svg' : rank + '-shimmer.svg'}" class="w-full absolute inset-0 h-full" alt="placement">
              <h1 class="text-4xl font-bold self-end italic absolute drop-shadow-[0px_3px_1px_#232323]">${rank}.</h1>
              <img src="${skinUrl(player)}" class="absolute right-7 drop-shadow-[-4px_-2px_1px_#00000077]" width="60" height="60" alt="${player.name}'s Skin">
            </div>
            <div class="w-72 truncate">
              <h2 class="text-2xl text-slate-300 font-bold truncate">${player.name}</h2>
              <h3 class="flex gap-1 text-disabled">
                <span class="truncate text-slate-400">${titleFor(player.points)} <span class="text-slate-600">(${player.points} points)</span></span>
              </h3>
            </div>
            <div class="h-[78px] md:bg-slate-700/10 flex items-center justify-center px-4 mr-2 max-md:ml-auto max-md:mr-0 md:ml-auto">
              <span class="size-10 p-2 text-xl rounded-md flex items-center justify-center font-extrabold">${player.region || 'EU'}</span>
            </div>
          </div>
          <div class="ml-auto h-full flex w-fit max-md:flex max-md:flex-wrap max-md:justify-between max-md:w-full max-md:px-1 max-md:py-2">
            <div class="space-y-1 w-full h-[inherit] flex md:items-center justify-center flex-col px-2">
              <h2 class="overall_player__label">Tiers</h2>
              <div class="overall_player__slots-wrapper max-sm:flex-wrap">
                ${modes.map((mode) => slot(mode, player.rankings?.[mode])).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function modeColumn(tier, players) {
    return `
      <div class="itstiers-fallback-column min-w-0 rounded-xl border-2 border-border bg-accent/10 p-3">
        <h2 class="text-xl font-bold text-slate-300 mb-3">Tier ${tier}</h2>
        <div class="space-y-2">
          ${players.map((player, index) => `
            <div class="flex items-center gap-2 bg-accent/20 border border-border rounded-lg p-2">
              <span class="text-muted w-6">${index + 1}.</span>
              <img src="${skinUrl(player)}" width="42" height="42" class="object-contain" alt="${player.name}'s Skin">
              <div class="min-w-0">
                <h3 class="font-bold text-slate-300 truncate">${player.name}</h3>
                <p class="text-sm text-slate-500">${player.region || 'EU'} · ${player.pos === 0 ? 'High' : 'Low'} Tier ${player.tier}</p>
              </div>
            </div>
          `).join('') || '<p class="text-sm text-slate-500">No players.</p>'}
        </div>
      </div>
    `;
  }

  function tableContainer() {
    const card = document.querySelector('main > div');
    if (!card) return null;
    card.querySelectorAll('.itstiers-fallback-root').forEach((node) => node.remove());
    return card;
  }

  async function renderOverall(card) {
    const res = await fetch(`${API_ROOT}/mode/overall?from=0&count=100`);
    const players = await res.json();
    const root = document.createElement('div');
    root.className = 'itstiers-fallback-root';
    root.innerHTML = Array.isArray(players) && players.length
      ? players.map(overallRow).join('')
      : '<p class="text-slate-500 p-4">No players found.</p>';
    card.appendChild(root);
  }

  async function renderMode(card, mode) {
    const res = await fetch(`${API_ROOT}/mode/${mode}?from=0&count=100`);
    const columns = await res.json();
    const root = document.createElement('div');
    root.className = 'itstiers-fallback-root mt-4 grid grid-cols-5 gap-2 max-xl:grid-cols-2 max-sm:grid-cols-1';
    root.innerHTML = [1, 2, 3, 4, 5].map((tier) => modeColumn(tier, columns?.[tier] || [])).join('');
    card.appendChild(root);
  }

  async function boot() {
    const card = tableContainer();
    if (!card) return;
    const mode = modeFromPath();

    try {
      if (mode === 'overall') {
        await renderOverall(card);
      } else {
        await renderMode(card, mode);
      }
    } catch (error) {
      console.error('Itstiers fallback ranking render failed:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
