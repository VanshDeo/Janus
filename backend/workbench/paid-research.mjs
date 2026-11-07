// Trusted supervisor configuration only: never deserialize wallet bindings from a browser.
export function createPaidResearchTools(bindings) {
 const entry = id => { const value = bindings[id]; if (!value) throw new Error('No authorized paid-tool binding for research worker'); return value; };
 return {
  async acquire(agentId, afterPaid, onReuse = async () => {}) {
   const binding = entry(agentId);
   const purchased = new Set();
   const acquire = () => binding.runner.run({ walletClient: binding.walletClient, afterPaid: async (result, step, reused) => {
    purchased.add(step);
    await (reused ? onReuse : afterPaid)(result, step);
   } });
   const state = binding.withSigner ? await binding.withSigner(binding.walletClient, acquire) : await acquire();
   for (const step of state.completed) if (!purchased.has(step.id)) await onReuse(step.result, step.id);
   // Only purchased content enters the model prompt, never wallet/receipt metadata.
   return state.completed.map(step => ({ step: step.id, content: step.result.result }));
  },
  worker(agentId) { return entry(agentId).walletClient.account.address; },
  async replace(agentId, failedWorker) {
   const binding = entry(agentId);
   if (binding.replace) {
    const result = await binding.replace(failedWorker);
    if (result.walletClient) binding.walletClient = result.walletClient;
    return result;
   }
   if (!binding.replacementWallet || typeof binding.eligible !== 'function') throw new Error('No authorized replacement');
   await binding.runner.handoff({ schedulerWallet: binding.schedulerWallet, replacement: binding.replacementWallet.account.address, eligible: binding.eligible });
   binding.walletClient = binding.replacementWallet;
  },
 };
}
