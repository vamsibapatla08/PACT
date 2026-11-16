
## Run 2026-11-16 01:20:38 UTC

- Contract `0x6eadb2b3829e6d9c30208ff4122c40df7682d79d` on chain 5042002
- Host `0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac`, payer2 `0x...`, payee `0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac`
- Pact 1 `0x37de018a53fb41d2bdf037095c212ed000000000000000000000000000000000`
- Pact 2 `0xffaa1ae6b7df4389b879537e9538021c00000000000000000000000000000000`

- TX pact1 createPact: `0xbccb8534377748c7f7ec594647bd24dd1348cb97f5359f3dfbf3b2bb47e0432f` (status 0x1) https://explorer.testnet.arc.io/tx/0xbccb8534377748c7f7ec594647bd24dd1348cb97f5359f3dfbf3b2bb47e0432f
- PASS pact1 createPact mined
- PASS pact1 after create: state Open, sharesPaid 0
- TX pact1 payShare (host): `0x73dc16f471d06be41d7f795b2742922aaad93eea1a41649995acfd5f914d9a0d` (status 0x1) https://explorer.testnet.arc.io/tx/0x73dc16f471d06be41d7f795b2742922aaad93eea1a41649995acfd5f914d9a0d
- PASS pact1 payShare (host) mined
- PASS pact1 after share 1: state Open, sharesPaid 1
- PASS pact1 after share 1: paid[0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac] = true
- PASS contract balance after share 1 changed by 10000000000000000 wei
- PASS double pay by host reverts with AlreadyPaid
- FAIL wrong amount by payer2: reverted, but not with WrongAmount: error: invalid value '0x...' for '--from <ADDRESS>': odd number of digits  For more information, try '--help'. 
- FAIL release by non-host (payer2): reverted, but not with NotHost: error: invalid value '0x...' for '--from <ADDRESS>': odd number of digits  For more information, try '--help'. 
- PASS release by host before full reverts with NotFull

## Run 2026-11-16 01:24:54 UTC

- Contract `0x6eadb2b3829e6d9c30208ff4122c40df7682d79d` on chain 5042002
- Host `0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac`, payer2 `0x2b5d7237397905210921fe8b6b0ae2107feb781b`, payee `0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac`
- Pact 1 `0x7fef6f488b9c4f91ae7dd05b9925be5300000000000000000000000000000000`
- Pact 2 `0x21c24dbaaf334c479e81bc38f72598bd00000000000000000000000000000000`

- TX pact1 createPact: `0x8af17e7375a9a2a2f8363d2a2de26f343ba62ee3cf505e9df429c2556a4c4756` (status 0x1) https://explorer.testnet.arc.io/tx/0x8af17e7375a9a2a2f8363d2a2de26f343ba62ee3cf505e9df429c2556a4c4756
- PASS pact1 createPact mined
- PASS pact1 after create: state Open, sharesPaid 0
- TX pact1 payShare (host): `0x24d5c0fa7a44f096875833fc9c23226035e9dec64123c7f0fac25d97d2df8927` (status 0x1) https://explorer.testnet.arc.io/tx/0x24d5c0fa7a44f096875833fc9c23226035e9dec64123c7f0fac25d97d2df8927
- PASS pact1 payShare (host) mined
- PASS pact1 after share 1: state Open, sharesPaid 1
- PASS pact1 after share 1: paid[0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac] = true
- PASS contract balance after share 1 changed by 10000000000000000 wei
- PASS double pay by host reverts with AlreadyPaid
- PASS wrong amount by payer2 reverts with WrongAmount
- PASS release by non-host (payer2) reverts with NotHost
- PASS release by host before full reverts with NotFull
- TX pact1 payShare (payer2): `0xb2a069b87fda9b10906a2d3e0bcd68d9baf0bbce801a0c31aeedc3761e4cf7ca` (status 0x1) https://explorer.testnet.arc.io/tx/0xb2a069b87fda9b10906a2d3e0bcd68d9baf0bbce801a0c31aeedc3761e4cf7ca
- PASS pact1 payShare (payer2) mined
- PASS pact1 after share 2: state Open, sharesPaid 2
- PASS pact1 after share 2: paid[0x2b5d7237397905210921fe8b6b0ae2107feb781b] = true
- PASS release by non-host when full (payer2) reverts with NotHost
- TX pact1 release: `0x1610adef756d1923ead0f4b0b30452ec642ea2a06a2924f3ab48f77a8280623f` (status 0x1) https://explorer.testnet.arc.io/tx/0x1610adef756d1923ead0f4b0b30452ec642ea2a06a2924f3ab48f77a8280623f
- PASS pact1 release mined
- PASS pact1 after release: state Released, sharesPaid 2
- PASS contract balance after release changed by -20000000000000000 wei
- PASS release again reverts with NotOpen
- TX pact2 createPact: `0x566b8df3c4222fb7aff99d3cc8d23fd6c53f308d51f427aa3c69582e6e0b9f6e` (status 0x1) https://explorer.testnet.arc.io/tx/0x566b8df3c4222fb7aff99d3cc8d23fd6c53f308d51f427aa3c69582e6e0b9f6e
- PASS pact2 createPact mined
- PASS pact2 after create: state Open, sharesPaid 0
- TX pact2 payShare (host): `0x1eaaa4f5b7238a4da1460d7416ba8acc87f4e1825ec35a4b18dfbd99d84d6ad6` (status 0x1) https://explorer.testnet.arc.io/tx/0x1eaaa4f5b7238a4da1460d7416ba8acc87f4e1825ec35a4b18dfbd99d84d6ad6
- PASS pact2 payShare (host) mined
- PASS pact2 after pay: state Open, sharesPaid 1
- PASS contract balance after pact2 pay changed by 10000000000000000 wei
- PASS cancel by non-host before deadline (payer2) reverts with CannotCancel
- TX pact2 cancel: `0xad1f8304b91238e95612b49fa92dfde3d29dd24b62561db90de4d2de5dbcdc8b` (status 0x1) https://explorer.testnet.arc.io/tx/0xad1f8304b91238e95612b49fa92dfde3d29dd24b62561db90de4d2de5dbcdc8b
- PASS pact2 cancel mined
- PASS pact2 after cancel: state Cancelled, sharesPaid 1
- PASS pay after cancel (payer2) reverts with NotOpen
- TX pact2 claimRefund (host): `0xc6b93c0b24f233eb8331c204aeb1098c73795d46f9a7c9565137d4b13418a12f` (status 0x1) https://explorer.testnet.arc.io/tx/0xc6b93c0b24f233eb8331c204aeb1098c73795d46f9a7c9565137d4b13418a12f
- PASS pact2 claimRefund (host) mined
- PASS pact2 after refund: paid[0xc9c4a5cd709df38f2a3a9058361d6a3e9b295aac] = false
- PASS contract balance after refund changed by -10000000000000000 wei
- PASS second refund reverts with NothingToRefund
- PASS refund by non-payer (payer2) reverts with NothingToRefund

**Result: 32 passed, 0 failed**
