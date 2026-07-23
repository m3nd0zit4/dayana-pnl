/** CRM agent (eve) is off by default — flip on once the agent has been reviewed. */
export const isAgentEnabled = () => process.env.CRM_AGENT_ENABLED === "true";
