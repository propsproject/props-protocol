## `AppPoints`

Each app in the Props protocol gets an associated ERC20-compatible AppPoints token. AppPoints tokens are mintable according to a known inflation rate. On every mint, a fixed percentage of the newly minted tokens (5%) goes to the Props treasury address, while the rest goes to the app's owner. Initially, AppPoints tokens are non-transferrable, only certain whitelisted addresses being able to perform transfers.

Every AppPoints token associated to an app comes in two variants, one residing on L1 and another on L2. These two variants are to be mapped together via a bridge, where L1 AppPoints tokens are getting locked on L1 and a corresponding amount of L2 AppPoints tokens are getting minted on L2. It is the responsibility of the app owner to map the two variants over a bridge so the AppPoints tokens can be ported across the two layers.

One caveat regarding AppPoints tokens is that pausing and whitelisting for transfers is available on both L1 and L2 and this state has to be kept in sync across the two layers in order to have consistency (although in some cases not keeping them in sync might be intended, eg. only whitelist an address on a single layer while having it blacklisted on the other).

Contracts of interest:

- `AppPointsCommon`: includes common AppPoints token functionality shared by both the L1 and L2 variants
- `AppPointsL1`: includes L1-specific AppPoints token functionality
- `AppPointsL2`: includes L2-specific AppPoints token functionality

### Architecture

The following functions are only available on the L1 variant of AppPoints tokens:

##### Mint

Mint new AppPoints tokens according to the set inflation rate. The number of new tokens that will get minted is equal to `(currentTime - lastMintTime) * inflationRate`. As mentioned, a fixed percentage of the newly minted tokens goes to the Props treasury address while the rest goes to the app's owner.

```solidity
function mint()
```

##### Change inflation rate

Change the AppPoints token's inflation rate. Once changed, there is a delay before the new inflation rate goes into effect.

```solidity
function changeInflationRate(uint256 _inflationRate)
```

The following actions are only available on the L2 variant of AppPoints tokens:

##### Update app info

Update the IPFS hash pointing to the app's info. Each app can have optional information associated to it (eg. bio, logo). This information is to be stored on IPFS, and the IPFS hash of it can be kept on-chain.

```solidity
function changeAppInfo(bytes _appInfo)
```

##### Set minter

Set the minter address. The intended role of this function is to allow AppPoints tokens to be ported over from L1 to L2 and back (the bridge must be granted permissions to mint tokens, on L2, if it detects L1 bridge deposits).

```solidity
function setMinter(address _minter)
```

The following functions are available on both the L1 and L2 variants of AppPoints tokens:

##### Pause

Pause any transfer. However, the app's owner is able to overcome this by allowing transfers from certain whitelisted addresses.

```solidity
function pause()
```

##### Unpause

Unpause the contract. This will re-enable transfers.

```solidity
function unpause()
```

##### Update transfer whitelist

Update the set of whitelisted addresses allowed to transfer when the transfers are paused. The whitelist is only relevant when transfers are paused.

```solidity
function updateTransferWhitelist(address _account, bool _status)
```
