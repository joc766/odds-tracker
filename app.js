const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_ROSTER_BASE = `${ESPN_BASE}/football/nfl/teams`;
const SLEEPER_STATE_URL = "https://api.sleeper.app/v1/state/nfl";
const selectionKey = "odds-desk-selection";

const elements = {
  league: document.querySelector("#league-select"),
  weekRange: document.querySelector("#week-range"),
  refresh: document.querySelector("#refresh-button"),
  body: document.querySelector("#bets-body"),
  alert: document.querySelector("#alert"),
  marketCount: document.querySelector("#market-count"),
  selectedCount: document.querySelector("#selected-count"),
  clear: document.querySelector("#clear-button"),
  save: document.querySelector("#save-button"),
  updated: document.querySelector("#last-updated"),
  dot: document.querySelector(".status-dot"),
  customToggle: document.querySelector("#custom-toggle"),
  customForm: document.querySelector("#custom-bet-form"),
  customGame: document.querySelector("#custom-game"),
  customType: document.querySelector("#custom-type"),
  alternateFields: document.querySelector("#alternate-fields"),
  customTeam: document.querySelector("#custom-team"),
  customLine: document.querySelector("#custom-line"),
  alternateTotalFields: document.querySelector("#alternate-total-fields"),
  customTotalSide: document.querySelector("#custom-total-side"),
  customTotalLine: document.querySelector("#custom-total-line"),
  touchdownFields: document.querySelector("#touchdown-fields"),
  touchdownPlayer: document.querySelector("#custom-touchdown-player"),
  touchdownThreshold: document.querySelector("#custom-touchdown-threshold"),
  propFields: document.querySelector("#prop-fields"),
  customPosition: document.querySelector("#custom-position"),
  customPlayer: document.querySelector("#custom-player"),
  customStat: document.querySelector("#custom-stat"),
  customSide: document.querySelector("#custom-side"),
  customPropLine: document.querySelector("#custom-prop-line"),
  customOdds: document.querySelector("#custom-odds"),
  selectedBody: document.querySelector("#selected-body"),
  parlayOdds: document.querySelector("#parlay-odds")
};

let selectedBets = new Set(JSON.parse(localStorage.getItem(selectionKey) || "[]"));
let betOverrides = JSON.parse(localStorage.getItem("odds-desk-overrides") || "{}");
let customBets = JSON.parse(localStorage.getItem("odds-desk-custom-bets") || "[]").filter((bet) => bet.marketType);
let currentMarkets = [];
let currentPlayers = [];

const propStats = {
  QB: [{ value: "passing_touchdowns", label: "Pass TDs" }, { value: "passing_yards", label: "Pass Yards" }],
  RB: [{ value: "rushing_yards", label: "Rush Yards" }],
  WR: [{ value: "receptions", label: "Receptions" }, { value: "receiving_yards", label: "Reception Yards" }],
  TE: [{ value: "receptions", label: "Receptions" }, { value: "receiving_yards", label: "Reception Yards" }]
};

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateRange(start, end) {
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start)} – ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(end)}`;
}

function getSeasonStartDate(season) {
  const start = new Date(Date.UTC(Number(season), 8, 1));
  while (start.getUTCDay() !== 4) start.setUTCDate(start.getUTCDate() + 1);
  return start;
}

function getDatesInRange(start, end) {
  const dates = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(formatDate(current).replaceAll("-", ""));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function getCurrentWeekRange() {
  const response = await fetch(SLEEPER_STATE_URL);
  if (!response.ok) throw new Error(`Sleeper returned HTTP ${response.status}`);
  const state = await response.json();
  const displayWeek = Number(state.display_week || state.week);
  if (!state.season || !displayWeek) throw new Error("Sleeper did not return a current NFL week");

  const start = state.season_start_date
    ? new Date(`${state.season_start_date}T00:00:00Z`)
    : getSeasonStartDate(state.season);
  if (Number.isNaN(start.getTime())) throw new Error("Sleeper returned an invalid season start date");
  start.setUTCDate(start.getUTCDate() + (7 * (displayWeek - 1)));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { season: state.season, week: displayWeek, start, end };
}

function formatGameTime(timestamp) {
  if (!timestamp) return "Time TBD";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function moneyline(value) {
  if (value === undefined || value === null || value === "") return "—";
  const number = Number(value);
  return number > 0 ? `+${number}` : String(number);
}

function addMarket(markets, event, type, pick, odds) {
  if (odds === undefined || odds === null || odds === "") return;
  markets.push({
    id: `${event.id}-${type}-${pick}`,
    eventId: event.id,
    event: event.name,
    shortEvent: event.shortName || event.name,
    teams: event.teams,
    type,
    pick,
    odds: String(odds),
    time: event.date
  });
}

function normalizeEvents(data) {
  const markets = [];
  for (const event of data.events || []) {
    for (const competition of event.competitions || []) {
      const odds = competition.odds?.[0];
      if (!odds) continue;
      const competitors = competition.competitors || [];
      const home = competitors.find((team) => team.homeAway === "home") || competitors[0];
      const away = competitors.find((team) => team.homeAway === "away") || competitors[1];
      const homeName = home?.team?.abbreviation || home?.team?.shortDisplayName || "Home";
      const awayName = away?.team?.abbreviation || away?.team?.shortDisplayName || "Away";
      event.teams = competitors.map((competitor) => ({
        id: competitor.team?.id,
        name: competitor.team?.displayName,
        abbreviation: competitor.team?.abbreviation,
        homeAway: competitor.homeAway
      })).filter((team) => team.id);
      const spread = odds.spread ?? odds.pointSpread?.home?.close?.line;
      if (spread !== undefined) {
        const homeSpread = Number(spread) > 0 ? `+${spread}` : spread;
        const awaySpread = Number(spread) < 0 ? `+${Math.abs(Number(spread))}` : `-${spread}`;
        addMarket(markets, event, "Spread", `${homeName} ${homeSpread}`, odds.pointSpread?.home?.close?.odds || odds.homeTeamOdds?.spread || homeSpread);
        addMarket(markets, event, "Spread", `${awayName} ${awaySpread}`, odds.pointSpread?.away?.close?.odds || odds.awayTeamOdds?.spread || awaySpread);
      }
      if (odds.overUnder !== undefined) {
        addMarket(markets, event, "Total", `Over ${odds.overUnder}`, odds.total?.over?.close?.odds || odds.overOdds || odds.overUnder);
        addMarket(markets, event, "Total", `Under ${odds.overUnder}`, odds.total?.under?.close?.odds || odds.underOdds || odds.overUnder);
      }
      addMarket(markets, event, "Moneyline", homeName, moneyline(odds.moneyline?.home?.close?.odds || odds.homeTeamOdds?.moneyLine));
      addMarket(markets, event, "Moneyline", awayName, moneyline(odds.moneyline?.away?.close?.odds || odds.awayTeamOdds?.moneyLine));
    }
  }
  return markets;
}

function showAlert(message) {
  elements.alert.textContent = message;
  elements.alert.hidden = false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function getBetValue(market, field) {
  return betOverrides[market.id]?.[field] ?? market[field];
}

function americanToDecimal(odds) {
  const number = Number(odds);
  if (!Number.isFinite(number) || number === 0) return null;
  return number > 0 ? 1 + (number / 100) : 1 + (100 / Math.abs(number));
}

function decimalToAmerican(decimal) {
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `-${Math.round(100 / (decimal - 1))}`;
}

function renderSelectedMarkets() {
  const selectedMarkets = currentMarkets.filter((market) => selectedBets.has(market.id));
  elements.selectedCount.textContent = selectedMarkets.length;
  elements.save.disabled = selectedMarkets.length === 0;
  if (!selectedMarkets.length) {
    elements.selectedBody.innerHTML = `<tr class="placeholder-row"><td colspan="5">No bets selected.</td></tr>`;
    elements.parlayOdds.textContent = "—";
    return;
  }

  elements.selectedBody.innerHTML = selectedMarkets.map((market) => `<tr>
    <td><span class="event-name">${escapeHtml(market.shortEvent)}</span><span class="event-meta">${escapeHtml(market.event)}</span></td>
    <td><span class="market-type">${escapeHtml(market.type)}</span></td>
    <td><span class="pick">${escapeHtml(getBetValue(market, "pick"))}</span></td>
    <td><input class="leg-input odds-input" data-edit-field="odds" data-edit-id="${escapeHtml(market.id)}" value="${escapeHtml(getBetValue(market, "odds"))}" placeholder="e.g. -110" /></td>
    <td><button class="remove-bet" type="button" data-remove-id="${escapeHtml(market.id)}">Remove</button></td>
  </tr>`).join("");

  const decimalOdds = selectedMarkets.map((market) => americanToDecimal(getBetValue(market, "odds")));
  elements.parlayOdds.textContent = decimalOdds.every(Boolean)
    ? decimalToAmerican(decimalOdds.reduce((total, odds) => total * odds, 1))
    : "—";
  elements.selectedBody.querySelectorAll("[data-remove-id]").forEach((button) => button.addEventListener("click", () => {
    selectedBets.delete(button.dataset.removeId);
    delete betOverrides[button.dataset.removeId];
    customBets = customBets.filter((market) => market.id !== button.dataset.removeId);
    persistSelection();
    localStorage.setItem("odds-desk-overrides", JSON.stringify(betOverrides));
    localStorage.setItem("odds-desk-custom-bets", JSON.stringify(customBets));
    render(currentMarkets.filter((market) => !market.isCustom));
  }));
  elements.selectedBody.querySelectorAll("[data-edit-field]").forEach((input) => input.addEventListener("input", () => {
    const id = input.dataset.editId;
    betOverrides[id] = { ...betOverrides[id], [input.dataset.editField]: input.value };
    localStorage.setItem("odds-desk-overrides", JSON.stringify(betOverrides));
    updateParlayOdds();
  }));
}

function updateParlayOdds() {
  const selectedMarkets = currentMarkets.filter((market) => selectedBets.has(market.id));
  const decimalOdds = selectedMarkets.map((market) => americanToDecimal(getBetValue(market, "odds")));
  elements.parlayOdds.textContent = decimalOdds.length && decimalOdds.every(Boolean)
    ? decimalToAmerican(decimalOdds.reduce((total, odds) => total * odds, 1))
    : "—";
}

function updateCustomGameOptions(markets) {
  const games = [...new Map(markets.map((market) => [market.eventId, market])).values()];
  const currentValue = elements.customGame.value;
  elements.customGame.innerHTML = `<option value="">Select a game</option>${games.map((game) => `<option value="${escapeHtml(game.eventId)}">${escapeHtml(game.shortEvent)}</option>`).join("")}`;
  if (games.some((game) => game.eventId === currentValue)) elements.customGame.value = currentValue;
  updateCustomFields();
}

function selectedGame() {
  return currentMarkets.find((market) => market.eventId === elements.customGame.value && !market.isCustom);
}

function setRequired(elementsToRequire) {
  [elements.customTeam, elements.customLine, elements.customTotalSide, elements.customTotalLine, elements.touchdownPlayer, elements.touchdownThreshold, elements.customPosition, elements.customPlayer, elements.customStat, elements.customSide, elements.customPropLine].forEach((element) => element.required = elementsToRequire.includes(element));
}

function updateCustomFields() {
  const type = elements.customType.value;
  elements.alternateFields.hidden = type !== "Alternate spread";
  elements.alternateTotalFields.hidden = type !== "Alternate total";
  elements.touchdownFields.hidden = type !== "Anytime touchdown";
  elements.propFields.hidden = type !== "Player prop";
  setRequired(type === "Alternate spread"
    ? [elements.customTeam, elements.customLine]
    : type === "Alternate total"
      ? [elements.customTotalSide, elements.customTotalLine]
    : type === "Anytime touchdown"
      ? [elements.touchdownPlayer, elements.touchdownThreshold]
      : [elements.customPosition, elements.customPlayer, elements.customStat, elements.customSide, elements.customPropLine]);

  const game = selectedGame();
  const teams = game?.teams || [];
  const currentTeam = elements.customTeam.value;
  elements.customTeam.innerHTML = `<option value="">Select a team</option>${teams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>`).join("")}`;
  if (teams.some((team) => team.id === currentTeam)) elements.customTeam.value = currentTeam;

  const gamePlayers = currentPlayers.filter((player) => teams.some((team) => String(team.id) === String(player.teamId)));
  const skillPlayers = gamePlayers.filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position));
  const currentTouchdownPlayer = elements.touchdownPlayer.value;
  elements.touchdownPlayer.innerHTML = `<option value="">${skillPlayers.length ? "Select a player" : "No players available"}</option>${skillPlayers.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} (${escapeHtml(player.position)})</option>`).join("")}`;
  if (skillPlayers.some((player) => player.id === currentTouchdownPlayer)) elements.touchdownPlayer.value = currentTouchdownPlayer;

  const positions = [...new Set(gamePlayers.map((player) => player.position).filter((position) => propStats[position]))].sort();
  const currentPosition = elements.customPosition.value;
  elements.customPosition.innerHTML = `<option value="">Select a position</option>${positions.map((position) => `<option value="${position}">${position}</option>`).join("")}`;
  if (positions.includes(currentPosition)) elements.customPosition.value = currentPosition;

  const positionPlayers = gamePlayers.filter((player) => player.position === elements.customPosition.value);
  const currentPlayer = elements.customPlayer.value;
  elements.customPlayer.innerHTML = `<option value="">${positionPlayers.length ? "Select a player" : "Select a position first"}</option>${positionPlayers.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}</option>`).join("")}`;
  if (positionPlayers.some((player) => player.id === currentPlayer)) elements.customPlayer.value = currentPlayer;

  const stats = propStats[elements.customPosition.value] || [];
  const currentStat = elements.customStat.value;
  elements.customStat.innerHTML = stats.map((stat) => `<option value="${stat.value}">${stat.label}</option>`).join("");
  if (stats.some((stat) => stat.value === currentStat)) elements.customStat.value = currentStat;
}

async function loadRosters(markets) {
  const teams = [...new Map(markets.flatMap((market) => market.teams || []).map((team) => [team.id, team])).values()];
  const rosterResponses = await Promise.all(teams.map((team) => fetch(`${ESPN_ROSTER_BASE}/${team.id}/roster`)));
  const failedResponse = rosterResponses.find((response) => !response.ok);
  if (failedResponse) throw new Error(`ESPN roster request returned HTTP ${failedResponse.status}`);
  const rosters = await Promise.all(rosterResponses.map((response) => response.json()));
  currentPlayers = rosters.flatMap((roster, index) => (roster.athletes || []).flatMap((group) => group.items || []).map((athlete) => ({
    id: athlete.id,
    name: athlete.displayName || athlete.fullName,
    position: athlete.position?.abbreviation,
    teamId: teams[index].id
  }))).filter((player) => player.id && player.name && player.position);
}

function render(markets) {
  elements.marketCount.textContent = markets.length;
  currentMarkets = [...markets, ...customBets];
  updateCustomGameOptions(markets);
  if (!markets.length) {
    elements.body.innerHTML = `<div class="placeholder-row">No odds are currently available for this NFL week.</div>`;
    renderSelectedMarkets();
    return;
  }
  const groups = new Map();
  markets.forEach((market) => {
    if (!groups.has(market.eventId)) groups.set(market.eventId, []);
    groups.get(market.eventId).push(market);
  });
  elements.body.innerHTML = [...groups.values()].map((gameMarkets) => {
    const game = gameMarkets[0];
    return `<details class="game-group">
      <summary><span><span class="event-name">${game.shortEvent}</span><span class="event-meta">${formatGameTime(game.time)} · ${game.event}</span></span><span class="game-summary-meta">${gameMarkets.length} markets <span class="chevron">⌄</span></span></summary>
      <div class="game-markets"><table><thead><tr><th class="check-column"><span class="sr-only">Select</span></th><th>Market</th><th>Pick</th><th>Odds</th></tr></thead><tbody>
        ${gameMarkets.map((market) => `<tr class="${selectedBets.has(market.id) ? "selected" : ""}">
          <td><input type="checkbox" data-bet-id="${market.id}" ${selectedBets.has(market.id) ? "checked" : ""} aria-label="Select ${market.pick} ${market.type} for ${market.shortEvent}" /></td>
          <td><span class="market-type">${market.type}</span></td><td><span class="pick">${market.pick}</span></td><td><span class="odds">${market.odds}</span></td>
        </tr>`).join("")}
      </tbody></table></div>
    </details>`;
  }).join("");
  elements.body.querySelectorAll("input[type=checkbox]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const row = checkbox.closest("tr");
    checkbox.checked ? selectedBets.add(checkbox.dataset.betId) : selectedBets.delete(checkbox.dataset.betId);
    row.classList.toggle("selected", checkbox.checked);
    persistSelection();
  }));
  renderSelectedMarkets();
}

function persistSelection() {
  localStorage.setItem(selectionKey, JSON.stringify([...selectedBets]));
  renderSelectedMarkets();
}

async function loadOdds() {
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Loading...";
  elements.alert.hidden = true;
  elements.body.innerHTML = `<div class="placeholder-row"><span class="loader"></span> Loading current markets...</div>`;
  try {
    const week = await getCurrentWeekRange();
    elements.weekRange.textContent = `Wk ${week.week} · ${formatDateRange(week.start, week.end)}`;
    const dailyResponses = await Promise.all(getDatesInRange(week.start, week.end).map((date) => fetch(`${ESPN_BASE}/${elements.league.value}/scoreboard?dates=${date}`)));
    const failedResponse = dailyResponses.find((response) => !response.ok);
    if (failedResponse) throw new Error(`ESPN returned HTTP ${failedResponse.status}`);
    const dailyData = await Promise.all(dailyResponses.map((response) => response.json()));
    const markets = normalizeEvents({ events: dailyData.flatMap((data) => data.events || []) });
    try {
      await loadRosters(markets);
    } catch (rosterError) {
      currentPlayers = [];
      showAlert(`Player rosters could not be loaded. Standard game bets are still available. ${rosterError.message}`);
    }
    render(markets);
    elements.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    elements.dot.classList.add("live");
  } catch (error) {
    elements.marketCount.textContent = "—";
    elements.body.innerHTML = `<div class="placeholder-row">Unable to load odds right now.</div>`;
    showAlert(`${error.message}. Check your connection or try refreshing.`);
    elements.updated.textContent = "Load failed";
    elements.dot.classList.remove("live");
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.textContent = "Refresh odds";
  }
}

elements.refresh.addEventListener("click", loadOdds);
elements.clear.addEventListener("click", () => {
  selectedBets.clear();
  customBets = [];
  localStorage.removeItem("odds-desk-custom-bets");
  persistSelection();
  loadOdds();
});
elements.customToggle.addEventListener("click", () => {
  const isHidden = elements.customForm.hidden;
  elements.customForm.hidden = !isHidden;
  elements.customToggle.setAttribute("aria-expanded", String(isHidden));
  if (isHidden) elements.customGame.focus();
});
elements.customType.addEventListener("change", updateCustomFields);
elements.customGame.addEventListener("change", updateCustomFields);
elements.customPosition.addEventListener("change", updateCustomFields);
elements.customForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const sourceGame = currentMarkets.find((market) => market.eventId === elements.customGame.value && !market.isCustom);
  if (!sourceGame) return;
  const teams = sourceGame.teams || [];
  const gamePlayers = currentPlayers.filter((player) => teams.some((team) => String(team.id) === String(player.teamId)));
  const id = `custom-${Date.now()}`;
  let customBet;
  if (elements.customType.value === "Alternate spread") {
    const team = teams.find((candidate) => candidate.id === elements.customTeam.value);
    const line = Number(elements.customLine.value);
    customBet = {
      id, marketType: "alternate_spread", teamId: team.id, line,
      type: "Alternate spread", pick: `${team.abbreviation} ${line > 0 ? "+" : ""}${line}`, odds: elements.customOdds.value.trim()
    };
  } else if (elements.customType.value === "Alternate total") {
    const line = Number(elements.customTotalLine.value);
    const side = elements.customTotalSide.value;
    customBet = {
      id, marketType: "alternate_total", side, line,
      type: "Alternate total", pick: `${side === "over" ? "Over" : "Under"} ${line}`, odds: elements.customOdds.value.trim()
    };
  } else if (elements.customType.value === "Anytime touchdown") {
    const player = gamePlayers.find((candidate) => candidate.id === elements.touchdownPlayer.value);
    const threshold = Number(elements.touchdownThreshold.value);
    customBet = {
      id, marketType: "anytime_touchdown", playerId: player.id, playerName: player.name, threshold,
      type: "Anytime touchdown", pick: `${player.name} ${threshold}+ TD`, odds: elements.customOdds.value.trim()
    };
  } else {
    const player = gamePlayers.find((candidate) => candidate.id === elements.customPlayer.value);
    const stat = propStats[elements.customPosition.value].find((candidate) => candidate.value === elements.customStat.value);
    const line = Number(elements.customPropLine.value);
    const side = elements.customSide.value;
    customBet = {
      id, marketType: "player_prop", playerId: player.id, playerName: player.name,
      position: elements.customPosition.value, stat: elements.customStat.value, side, line,
      type: "Player prop", pick: `${player.name} ${side} ${line} ${stat.label}`, odds: elements.customOdds.value.trim()
    };
  }
  customBet.eventId = sourceGame.eventId;
  customBet.event = sourceGame.event;
  customBet.shortEvent = sourceGame.shortEvent;
  customBet.time = sourceGame.time;
  customBet.isCustom = true;
  customBets.push(customBet);
  selectedBets.add(customBet.id);
  localStorage.setItem("odds-desk-custom-bets", JSON.stringify(customBets));
  persistSelection();
  elements.customForm.reset();
  elements.customForm.hidden = true;
  elements.customToggle.setAttribute("aria-expanded", "false");
  render(currentMarkets.filter((market) => !market.isCustom));
});
elements.save.addEventListener("click", () => showAlert("Saving to the local API is not enabled yet. Your selections are stored in this browser only."));
persistSelection();
loadOdds();
