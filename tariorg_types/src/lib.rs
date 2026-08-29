use std::fmt;
use tari_bor::{CborLen, Decode, Encode, minicbor};
use tari_template_lib::macros::rust::collections::HashMap;
use tari_template_lib::prelude::*;

#[derive(Encode, Decode, PartialEq, Debug, CborLen, Clone)]
pub struct Proposal {
    #[n(0)]
    pub action: ProposalAction,
    #[n(1)]
    pub votes: HashMap<RistrettoPublicKeyBytes, bool>,
    #[n(2)]
    pub total_yes: usize,
}

#[derive(Encode, Decode, PartialEq, Debug, CborLen, Clone, Copy)]
pub struct Send {
    #[n(0)]
    pub recipient: ComponentAddress,
    #[n(1)]
    pub amount: Amount,
    #[n(2)]
    pub resource: ResourceAddress,
}

#[derive(Encode, Decode, PartialEq, Debug, CborLen, Clone)]
pub struct Invoke {
    #[n(0)]
    pub target: ComponentAddress,
    #[n(1)]
    pub method: String,
    #[n(2)]
    pub args: Vec<Bytes>,
}

#[derive(Encode, Decode, PartialEq, Debug, CborLen, Clone)]
pub enum ProposalAction {
    #[n(0)]
    AddMember(#[n(0)] RistrettoPublicKeyBytes),
    #[n(1)]
    RemoveMember(#[n(0)] RistrettoPublicKeyBytes),
    #[n(2)]
    Send(#[n(0)] Send),
    #[n(3)]
    Invoke(#[n(0)] Invoke),
}

impl fmt::Display for ProposalAction {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ProposalAction::AddMember(addr) => write!(f, "AddMember({})", addr),
            ProposalAction::RemoveMember(addr) => write!(f, "RemoveMember({})", addr),
            ProposalAction::Send(send) => write!(
                f,
                "Send({} {} to {})",
                send.amount, send.resource, send.recipient
            ),
            _ => write!(f, "{:?})", self),
        }
    }
}
