-- 025: Flows can hand the conversation to an AI agent.
-- New node type `handoff_ai_agent` ({ agent_id }): sets
-- conversations.ai_agent_id, completes the run and lets that agent answer
-- the triggering message right away (src/lib/flows/engine.ts).

ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK (node_type IN (
  'start',
  'send_buttons',
  'send_list',
  'send_message',
  'collect_input',
  'condition',
  'set_tag',
  'handoff',
  'handoff_ai_agent',
  'http_fetch',
  'end'
));
