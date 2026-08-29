#![feature(integer_casts)]
#![feature(float_conversions)]
use tari_template_lib::prelude::*;

// PLANNED (if possible):
// - Make the OwnerRule self-owned by the Organization component
// - Use dynamic access rules for methods auth. Benchmark cost vs using the members list
// - Invoke action: Allow to pass buckets, badges maybe? stuff that is owned by the Organization and passed when invoking methods
// - Research PrehashedMap from Account implementation to replace HashMap and look for something similar for HashSet
// - Dynamic actions, allow to add and remove actions
// - RBAC: Members roles and granular action validation, compose eg: votes, one-of-role, one-of-member; and allow to apply to one action path
// - Research about privacy, what is possible about:
//   - Support stealthy resources
//   - Make votes anonymous
//   - Make members hidden for non-members
//   - Make configuration hidden for non-members
//   - Make actions hidden for non-members
//   - Toggleable and granular privacy, eg: reveal some things only

#[template]
mod template {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use tari_template_lib::macros::rust::collections::{HashMap, HashSet};
    use tariorg_types::{Proposal, ProposalAction};

    use super::*;

    // TODO: try to define Organization data in tariorg_types
    pub struct Organization {
        // Members are identified by the top-level transaction signer's public key.
        pub members: HashSet<RistrettoPublicKeyBytes>,
        // Treasury vaults.
        pub vaults: HashMap<ResourceAddress, Vault>,
        pub threshold_ratio: f64,
        pub proposals: HashMap<u64, Proposal>,
        pub next_proposal_id: u64,
    }

    impl Organization {
        pub fn new(
            initial_members: HashSet<RistrettoPublicKeyBytes>,
            threshold_ratio: f64,
        ) -> Component<Self> {
            let access_rules = ComponentAccessRules::new()
                .method("deposit", rule![allow_all])
                .method("vote", rule![allow_all])
                .method("execute", rule![allow_all])
                .method("propose", rule![allow_all])
                .method("is_member", rule![allow_all]);

            // Construct the component
            Component::new(Self {
                members: initial_members,
                vaults: Default::default(),
                threshold_ratio,
                next_proposal_id: 1,
                proposals: Default::default(),
            })
            .with_access_rules(access_rules)
            .with_owner_rule(OwnerRule::None)
            .create()
        }

        /** Implements the Account.deposit interface **/
        pub fn deposit(&mut self, bucket: Bucket) {
            // Ignore empty buckets
            if bucket.is_empty() {
                bucket.drop_empty();
                return;
            }
            // An event is emitted by the vault.deposit method
            let resource_address = bucket.resource_address();
            let vault_mut = self
                .vaults
                .entry(resource_address)
                .or_insert_with(|| Vault::new_empty(resource_address));
            vault_mut.deposit(bucket);
        }

        /// Open enrollment is intentionally absent: members are added and removed via
        /// governance proposals (`ProposalAction::AddMember` / `RemoveMember`), and the
        /// founder is the initial member.
        pub fn is_member(&self, id: RistrettoPublicKeyBytes) -> bool {
            self.members.contains(&id)
        }

        pub fn propose(&mut self, action: ProposalAction) -> u64 {
            let proposer = CallerContext::transaction_signer_public_key();

            // Check proposer is active member
            assert!(self.members.contains(&proposer), "not a member");

            let proposal_id = self.next_proposal_id;
            self.next_proposal_id += 1;

            let mut buffer: Vec<u8> = Vec::new();
            minicbor::encode(&action, &mut buffer).unwrap();

            let proposal = Proposal {
                action,
                votes: Default::default(),
                total_yes: 0,
            };

            self.proposals.insert(proposal_id, proposal);

            emit_event(
                "Proposed",
                metadata![
                    "proposal_id" => proposal_id.to_string(),
                    "proposer" => proposer.to_string(),
                    "action" => URL_SAFE_NO_PAD.encode(buffer),
                ],
            );

            proposal_id
        }

        pub fn vote(&mut self, proposal_id: u64, support: bool) {
            let voter = CallerContext::transaction_signer_public_key();

            // Check voter is active member
            assert!(self.members.contains(&voter), "not a member");

            // Get mutable proposal
            let proposal = self.proposals.get_mut(&proposal_id).unwrap();

            // Record vote and update sum for O(1) tallying
            let prev = proposal.votes.insert(voter, support);
            if let Some(true) = prev {
                if !support {
                    proposal.total_yes -= 1
                }
            } else if support {
                proposal.total_yes += 1
            }

            // Emit vote event
            emit_event(
                "Voted",
                metadata![
                    "proposal_id" => proposal_id.to_string(),
                    "voter" => voter.to_string(),
                    "support" => support.to_string(),
                ],
            );
        }

        pub fn execute(&mut self, proposal_id: u64) {
            let proposal = self.proposals.get(&proposal_id).unwrap();

            // Check threshold
            // NOTE: Using a float for the ratio because it's easier for consumer of this API, no need to think about decimals.
            //       Could use a fixed-point if there is a reproducibility problems in other runtimes (especially javascript).
            //       Ceil so that a fractional quorum rounds up (e.g. 66% of 2 = 2), matching the webui's `Math.ceil`.
            let threshold: usize = (self.threshold_ratio
                * f64::from(self.members.len().checked_cast::<u32>().unwrap()))
            .ceil()
            .to_int_strict();
            assert!(proposal.total_yes >= threshold);

            let action = proposal.action.clone();
            self.proposals.remove(&proposal_id);

            // Execute the action
            match &action {
                ProposalAction::AddMember(id) => {
                    if self.members.len() >= u32::MAX.checked_cast().unwrap() {
                        panic!["Too much members"]
                    }
                    self.members.insert(*id);
                }
                ProposalAction::RemoveMember(id) => {
                    self.members.remove(id);
                }
                ProposalAction::Send(send) => {
                    let vault = self.vaults.get(&send.resource).unwrap();
                    let bucket = vault.withdraw(send.amount);
                    let recipient = ComponentManager::get(send.recipient);
                    recipient.invoke("deposit", args![bucket])
                }
                ProposalAction::Invoke(invoke) => {
                    let component = ComponentManager::get(invoke.target);
                    component.invoke(invoke.method.clone(), invoke.args.clone())
                }
            }

            emit_event(
                "Executed",
                metadata![
                    "proposal_id" => proposal_id.to_string(),
                ],
            );
        }
    }
}
