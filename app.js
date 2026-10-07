const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
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
  selectedBody: document.querySelector("#selected-body"),
  parlayOdds: document.querySelector("#parlay-odds")
};

let selectedBets = new Set(JSON.parse(localStorage.getItem(selectionKey) || "[]"));
let currentMarkets = [];

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
    <td><span class="event-name">${market.shortEvent}</span><span class="event-meta">${market.event}</span></td>
    <td><span class="market-type">${market.type}</span></td><td><span class="pick">${market.pick}</span></td>
    <td><span class="odds">${market.odds}</span></td><td><button class="remove-bet" type="button" data-remove-id="${market.id}">Remove</button></td>
  </tr>`).join("");

  const decimalOdds = selectedMarkets.map((market) => americanToDecimal(market.odds));
  elements.parlayOdds.textContent = decimalOdds.every(Boolean)
    ? decimalToAmerican(decimalOdds.reduce((total, odds) => total * odds, 1))
    : "—";
  elements.selectedBody.querySelectorAll("[data-remove-id]").forEach((button) => button.addEventListener("click", () => {
    selectedBets.delete(button.dataset.removeId);
    persistSelection();
    render(currentMarkets);
  }));
}

function render(markets) {
  elements.marketCount.textContent = markets.length;
  currentMarkets = markets;
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
elements.clear.addEventListener("click", () => { selectedBets.clear(); persistSelection(); loadOdds(); });
elements.save.addEventListener("click", () => showAlert("Saving to the local API is not enabled yet. Your selections are stored in this browser only."));
persistSelection();
loadOdds();
