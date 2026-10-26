/* ==========================================================================
   state.js — State persistence, backup export/import
   Depends on globals: state, sanitizeState, saveState, refreshAllUI
   ========================================================================== */

function sanitizeState(data) {
    if (!data) return {};

    data.importedPositions = data.importedPositions || [];
    data.customAccounts = data.customAccounts || [];
    data.cds = data.cds || [];
    data.realEstate = data.realEstate || [];
    data.vehicles = data.vehicles || [];
    data.sideGigLedger = data.sideGigLedger || [];
    data.importedFiles = data.importedFiles || [];

    data.vehicles.forEach((v) => {
        if (!v.year) v.year = new Date().getFullYear();
        if (!v.make) v.make = '';
        if (!v.model) v.model = '';
        if (!v.trim) v.trim = '';
        if (!v.mileage) v.mileage = 0;
        if (!v.condition) v.condition = 'Good';
        if (!v.currentValue) v.currentValue = 0;
        if (!v.purchasePrice) v.purchasePrice = 0;
        if (!v.loanBalance) v.loanBalance = 0;
        if (!v.monthlyPayment) v.monthlyPayment = 0;
        if (!v.notes) v.notes = '';
    });

    data.realEstate.forEach((re) => {
        if (!re.marketValue) re.marketValue = 0;
        if (!re.purchasePrice) re.purchasePrice = 0;
        if (!re.mortgageBalance) re.mortgageBalance = 0;
        if (!re.monthlyPayment) re.monthlyPayment = 0;
        if (!re.type) re.type = 'Primary Home';
        if (!re.address) re.address = '';
        if (!re.notes) re.notes = '';
    });

    data.customAccounts.forEach((acc) => {
        if (acc.apy === undefined || acc.apy === null) acc.apy = 0;
        if (acc.value === undefined || acc.value === null) acc.value = 0;
    });

    data.cds.forEach((cd) => {
        if (cd.startDate === undefined || cd.startDate === null)
            cd.startDate = '';
        if (cd.principal === undefined || cd.principal === null)
            cd.principal = 0;
        if (cd.rate === undefined || cd.rate === null) cd.rate = 0;
    });

    // Ensure projectionSettings has age fields
    if (data.projectionSettings) {
        if (!data.projectionSettings.currentAge)
            data.projectionSettings.currentAge = 30;
        if (!data.projectionSettings.retireAge)
            data.projectionSettings.retireAge = 60;
    }

    // Ensure insurance fields are always present
    if (!data.insurances)
        data.insurances = {
            car: { amt: 0, freq: '6month' },
            home: { amt: 0, freq: 'monthly' },
        };
    if (!data.insurances.car) data.insurances.car = { amt: 0, freq: '6month' };
    if (!data.insurances.home)
        data.insurances.home = { amt: 0, freq: 'monthly' };

    return data;
}

// Revision of the server state this tab's copy was loaded at (see the
// optimistic-concurrency check in app/routes/state.js). Kept outside
// `state` so importing a JSON backup can't carry a stale one in. null =
// never synced (server unreachable) → saves fall back to last-write-wins.
let syncedRevision = null;
const revisionOf = (data) =>
    Number.isInteger(data?.stateRevision) ? data.stateRevision : 0;

async function loadStateFromServer() {
    try {
        const res = await fetch('/api/state');
        if (res.ok) {
            const data = await res.json();
            if (
                data &&
                typeof data === 'object' &&
                Object.keys(data).length > 0
            ) {
                state = sanitizeState({ ...state, ...data });
                syncedRevision = revisionOf(data);
                reportDeployMode(true);
                console.log('State loaded successfully from backend DB.');
                return;
            }
        }
        // Any answer other than 404 means a server is there, whatever it
        // thinks of this request. 404 is the hosted deploy: /api/state is
        // routed in every build that has a server, and the Netlify catch-all
        // answers with "not available in the hosted browser deployment".
        reportDeployMode(res.status !== 404);
    } catch (e) {
        console.warn(
            'Express backend unreachable. Falling back to localStorage.',
            e,
        );
        reportDeployMode(false);
    }
    loadStateFromStorage();
    // Opening the app is enough to keep the history going: the hosted deploy
    // has no server timer, so without this a user who only ever reads would
    // collect no points. Persist directly — there is no server to post to.
    if (syncedRevision === null && recordLocalNetWorthSnapshot())
        localStorage.setItem('fire_tracker_state', JSON.stringify(state));
}

// Hands the deploy mode to app/lib/deploy-mode.js, so provider status cards
// stop inferring "hosted" from a null syncedRevision — which is also true
// for a self-hosted tab whose /api/state has not answered yet (#292).
function reportDeployMode(hasServer) {
    if (typeof FireDeployMode === 'undefined') return;
    FireDeployMode.resolve(hasServer);
}

// A tab left open keeps its own in-memory copy of the data, and any edit
// made there calls saveState(), which posts that whole (possibly hours-old)
// copy over newer changes made in another tab or via the API/MCP. So when
// the tab becomes visible again, re-sync from the server first — unless an
// edit is in progress, which we'd otherwise throw away.
function isEditInProgress() {
    if (
        editingAccounts.length ||
        editingCDs.length ||
        editingRealEstate.length ||
        editingVehicles.length
    )
        return true;
    const el = document.activeElement;
    return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

// Set when a visibility re-sync had to wait for an edit; retried as soon
// as the edit ends (see initStaleTabResync).
let resyncPending = false;

async function resyncStateFromServer({ force = false } = {}) {
    if (!force && isEditInProgress()) {
        resyncPending = true;
        return false;
    }
    try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (!res.ok) return false;
        const data = await res.json();
        if (!data || typeof data !== 'object' || !Object.keys(data).length)
            return false;
        // Re-check: the user may have started editing while we fetched.
        if (!force && isEditInProgress()) {
            resyncPending = true;
            return false;
        }
        state = sanitizeState({ ...state, ...data });
        syncedRevision = revisionOf(data);
        reportDeployMode(true);
        resyncPending = false;
        if (typeof syncExpenseInputsFromState === 'function')
            syncExpenseInputsFromState();
        refreshAllUI();
        return true;
    } catch (e) {
        console.warn('Could not re-sync state from the server.', e);
        return false;
    }
}

function initStaleTabResync() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resyncStateFromServer();
    });
    // A deferred re-sync runs once the edit that blocked it ends: focus
    // leaving a field, or a click (Save / Cancel on an inline edit). Short
    // delay so the edit's own handlers (and any save) run first. Even if a
    // save beats it, the server's revision check rejects a stale copy.
    const retry = () =>
        setTimeout(() => {
            if (
                resyncPending &&
                document.visibilityState === 'visible' &&
                !isEditInProgress()
            )
                resyncStateFromServer();
        }, 300);
    document.addEventListener('focusout', retry);
    document.addEventListener('click', retry);
}

function loadStateFromStorage() {
    const savedState = localStorage.getItem('fire_tracker_state');
    if (savedState) {
        try {
            const parsed = JSON.parse(savedState);
            state = sanitizeState({ ...state, ...parsed });
            state.expenses = { ...state.expenses, ...(parsed.expenses || {}) };
            state.projectionSettings = {
                ...state.projectionSettings,
                ...(parsed.projectionSettings || {}),
            };
        } catch (e) {
            console.error('Error parsing localstorage state', e);
        }
    }
}

// Saves run one at a time: each needs the revision returned by the one
// before it (inputs save on every keystroke, so two could otherwise race
// with the same base revision and the second would be refused).
let saveQueue = Promise.resolve();

// Appends/updates today's net-worth point on `state` (see postState). Uses
// the same aggregates the dashboard shows, so the history chart reads the
// numbers the user is looking at. No pricesAsOf/stale here — those need the
// server's price bookkeeping; the browser has no such timestamps.
function recordLocalNetWorthSnapshot(now = new Date()) {
    const s = state || {};
    const agg = window.FireAggregates;
    if (!agg) return null;
    if (
        !(s.importedPositions || []).length &&
        !(s.customAccounts || []).length &&
        !(s.cds || []).length &&
        !(s.realEstate || []).length &&
        !(s.vehicles || []).length
    )
        return null; // nothing to record — don't start history at $0

    const r2 = (n) => Math.round(n * 100) / 100;
    return window.FireDailySnapshot.upsertDailySnapshot(
        s,
        {
            total: r2(agg.getAggregateNetWorth(s)),
            cash: r2(
                agg.getAggregateCash(s.importedPositions, s.customAccounts),
            ),
            cds: r2(agg.getAggregateCDs(s.cds)),
            equities: r2(
                agg.getAggregateEquities(s.importedPositions, s.customAccounts),
            ),
            otherAssets: r2(agg.getAggregateOtherAssets(s.customAccounts)),
            realEstate: r2(agg.getAggregateRealEstate(s.realEstate)),
            vehicles: r2(agg.getAggregateVehicles(s.vehicles)),
        },
        now,
    );
}

function saveState({ preserveSavedAt = false } = {}) {
    const run = saveQueue.then(
        () => postState(preserveSavedAt),
        () => postState(preserveSavedAt),
    );
    saveQueue = run.catch(() => {});
    return run;
}

async function postState(preserveSavedAt = false) {
    // Stamp before the write so an export taken right after an edit carries
    // the same timestamp the server sees. A backup restore keeps the
    // timestamp it was imported with — that is when the data was last edited.
    // ponytail: one-shot flag, not a stored preference; a per-write option is
    // all a restore needs.
    if (!preserveSavedAt) state.lastSavedAt = new Date().toISOString();
    // With no server there is nothing to record daily net-worth points for
    // us (the Express timer in server.js never runs on the hosted deploy),
    // so do it here — that is what keeps the history chart and
    // get_net_worth_trend from staying empty. The server owns the field
    // whenever it is reachable (routes/state.js drops a client copy).
    if (syncedRevision === null) recordLocalNetWorthSnapshot();
    localStorage.setItem('fire_tracker_state', JSON.stringify(state));

    try {
        const body =
            syncedRevision === null
                ? state
                : { ...state, baseRevision: syncedRevision };
        const res = await fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 409) {
            // Another tab saved newer data after this copy was loaded.
            // Don't overwrite it: pull the latest and ask the user to redo
            // the change on top of it.
            await resyncStateFromServer({ force: true });
            alert(
                'This tab was out of date — newer changes were saved elsewhere. ' +
                    'It has been refreshed with the latest data; please redo your last change.',
            );
            return;
        }
        if (!res.ok) {
            console.error('Server API returned status', res.status);
            return;
        }
        const data = await res.json().catch(() => null);
        if (Number.isInteger(data?.stateRevision))
            syncedRevision = data.stateRevision;
    } catch (e) {
        console.warn('Could not save state to Express backend server.', e);
    }
}

// Backup Export & Import Utility
document.getElementById('btn-backup-export').addEventListener('click', () => {
    const dataStr =
        'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
        'download',
        `fire_tracker_backup_${new Date().toISOString().slice(0, 10)}.json`,
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

const backupFileTrigger = document.getElementById('btn-backup-import-trigger');
const backupFileInput = document.getElementById('backup-file-input');

backupFileTrigger.addEventListener('click', () => backupFileInput.click());
backupFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedState = JSON.parse(event.target.result);
            if (importedState && typeof importedState === 'object') {
                state = sanitizeState(importedState);
                await saveState();
                refreshAllUI();
                alert('Backup imported successfully!');
            } else {
                alert('Invalid backup structure.');
            }
        } catch (err) {
            alert('Failed to parse backup JSON file: ' + err.message);
        }
    };
    reader.readAsText(file);
});
