use tari_template_lib::prelude::*;

#[template]
mod template {
    use super::*;

    /// Fixed faucet amount in microtari: 1 TARI per claim. Kept small so the
    /// Esmeralda faucet (funded from a modest personal tTARI balance) can serve
    /// many demo accounts. 1 TARI is enough to create an organization and run a
    /// handful of propose/vote/execute rounds (~0.004 TARI per transaction fee).
    const FAUCET_AMOUNT: u64 = 1_000_000;

    pub struct Faucet {
        vault: Vault,
    }

    impl Faucet {
        /// Creates a demo faucet pre-funded with `initial` (a bucket of tTARI).
        pub fn new(initial: Bucket) -> Component<Self> {
            Component::new(Self {
                vault: Vault::from_bucket(initial),
            })
            .with_owner_rule(OwnerRule::None)
            .with_access_rules(
                ComponentAccessRules::new()
                    .method("take", rule![allow_all])
                    .method("deposit", rule![allow_all])
                    .default(rule![deny_all]),
            )
            .create()
        }

        /// Gives exactly `FAUCET_AMOUNT` tTARI to the caller. Permissionless: the
        /// demo faucet lets any account claim, as often as it wants (until the
        /// vault runs dry; `deposit` tops it back up).
        pub fn take(&self, component: ComponentManager) {
            emit_event("take", metadata!["amount" => FAUCET_AMOUNT.to_string()]);
            let bucket = self.vault.withdraw(FAUCET_AMOUNT);
            component.invoke("deposit", args!(bucket));
        }

        /// Tops up the faucet vault. Permissionless: any caller may add funds.
        pub fn deposit(&self, bucket: Bucket) {
            self.vault.deposit(bucket);
        }
    }
}
