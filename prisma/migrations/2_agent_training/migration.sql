-- Training context of each AI agent: free text the business writes (products,
-- policies, FAQs, how to talk to customers). Goes into the agent's prompt as
-- its primary knowledge. Up to 5,000 characters.
ALTER TABLE public.ai_agents ADD COLUMN IF NOT EXISTS training_context text;
ALTER TABLE public.ai_agents DROP CONSTRAINT IF EXISTS ai_agents_training_context_length;
ALTER TABLE public.ai_agents ADD CONSTRAINT ai_agents_training_context_length CHECK (training_context IS NULL OR char_length(training_context) <= 5000);
