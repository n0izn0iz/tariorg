use std::collections::HashSet;
use tari_template_lib::prelude::ComponentAddress;
use tari_template_test_tooling::{
    TemplateTest,
    byte_type::ToByteType,
    crypto::{PublicKey, RistrettoPublicKey},
    transaction::args,
};
use tariorg_types::ProposalAction;

#[test]
fn humans_can_govern_with_public_keys() {
    let mut test = TemplateTest::new(".", ["."]);

    // 1. The founder creates the org with themselves as the initial member.
    let mut initial_members = HashSet::new();
    initial_members.insert(test.to_public_key_bytes());
    let org: ComponentAddress = test.call_function(
        "Organization",
        "new",
        args![initial_members, 1.0],
        vec![test.owner_proof()],
    );

    // 2. A second account (not yet a member).
    let (_account_b, owner_proof_b, secret_key_b) = test.create_empty_account();
    let pk_b = RistrettoPublicKey::from_secret_key(&secret_key_b).to_byte_type();

    // 3. Negative: a non-member cannot propose.
    test.execute_expect_failure(
        test.transaction()
            .call_method(org, "propose", args![ProposalAction::AddMember(pk_b)])
            .build_and_seal(&secret_key_b),
        vec![owner_proof_b.clone()],
    );

    // 4. The founder proposes adding B, then votes yes.
    test.execute_expect_success(
        test.transaction()
            .call_method(org, "propose", args![ProposalAction::AddMember(pk_b)])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );
    test.execute_expect_success(
        test.transaction()
            .call_method(org, "vote", args![1u64, true])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );

    // 5. Execute proposal 1 (threshold 1.0 * 1 member = 1 yes vote).
    test.execute_expect_success(
        test.transaction()
            .call_method(org, "execute", args![1u64])
            .build_and_seal(test.secret_key()),
        vec![test.owner_proof()],
    );

    // 6. B is now a member.
    let is_member: bool = test.call_method(org, "is_member", args![pk_b], vec![test.owner_proof()]);
    assert!(is_member);
}
