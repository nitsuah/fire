/**
 * Tool groups for the hosted bridge scope (#511). Pure and shared: the relay
 * lists and gates tools by group, the consent page shows the groups, and the
 * browser bridge host re-checks the same map independently.
 *
 * Deny by default: a tool that is in no group is never listed or callable, and
 * an unknown group grants nothing. Transactions start unticked on the consent
 * page (design D1).
 */
export const TOOL_GROUPS = {
    summary: {
        label: 'Net worth and FIRE progress',
        tools: [
            'fire_status_summary',
            'get_net_worth',
            'get_net_worth_trend',
            'get_projection_settings',
            'get_swr_sensitivity',
            'get_emergency_runway',
        ],
    },
    accounts: {
        label: 'Accounts, holdings and wallets',
        tools: [
            'get_accounts',
            'get_portfolio',
            'get_cds',
            'get_wallets',
            'get_concentration_risk',
            'get_diversification_score',
            'simulate_rebalance',
        ],
    },
    planning: {
        label: 'Expenses, insurance and upcoming events',
        tools: ['get_expenses', 'get_insurances', 'get_upcoming_events'],
    },
    income: {
        label: 'Side-gig income and tax',
        tools: ['get_side_gig_income', 'get_side_gig_tax_summary'],
    },
    transactions: {
        label: 'Individual transactions and recurring charges',
        tools: ['get_transactions', 'get_recurring_charges'],
    },
};

export const DEFAULT_UNTICKED_GROUPS = ['transactions'];

/** The tool names a scope (a list of group names) allows. */
export function toolsForScope(scope) {
    const allowed = new Set();
    if (!Array.isArray(scope)) return allowed;
    for (const group of scope) {
        const entry = Object.hasOwn(TOOL_GROUPS, group)
            ? TOOL_GROUPS[group]
            : null;
        if (entry) for (const t of entry.tools) allowed.add(t);
    }
    return allowed;
}
