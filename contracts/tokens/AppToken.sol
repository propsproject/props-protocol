// SPDX-License-Identifier: MIT
pragma solidity 0.6.8;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import "../interfaces/IAppToken.sol";

/**
 * @title  AppToken
 * @author Props
 * @notice ERC20 token every app in the Props protocol gets associated with.
 * @dev    Each app in the Props protocol will get an associated AppToken contract.
 *         AppTokens are ERC20 compatible and mintable according to an inflation rate.
 *         Besides, AppTokens are pausable but this restriction can be overcame via
 *         whitelisting, which only the owner is allowed to do.
 */
contract AppToken is Initializable, OwnableUpgradeable, IERC20Upgradeable, IAppToken {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // The Props protocol treasury address
    address public propsTreasury;

    // The percentage of each mint that goes to the Props treasury (denoted in ppm)
    uint256 public propsTreasuryMintPercentage;
    // The delay before a newly set inflation rate goes into effect
    uint256 public inflationRateChangeDelay;
    // The inflation rate of the app token
    uint256 public inflationRate;
    // The new inflation rate that will go into effect once the delay passes
    uint256 public pendingInflationRate;

    // Time most recent mint occured at
    uint256 public lastMint;
    // Time most recent inflation rate change occured at
    uint256 public lastInflationRateChange;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;
    // solhint-disable-next-line var-name-mixedcase
    bytes32 public PERMIT_TYPEHASH;

    mapping(address => uint256) public nonces;

    event InflationRateChanged(uint256 oldInflationRate, uint256 newInflationRate);

    /**
     * @dev Initializer.
     * @param _name The name of the app token
     * @param _symbol The symbol of the app token
     * @param _amount Initial amount of app tokens to mint
     * @param _owner The owner of the app token
     * @param _propsTreasury The Props protocol treasury
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        uint256 _amount,
        address _owner,
        address _propsTreasury
    ) public initializer {
        OwnableUpgradeable.__Ownable_init();
        __ERC20_init(_name, _symbol);

        propsTreasury = _propsTreasury;
        propsTreasuryMintPercentage = 50000; // 5%
        inflationRateChangeDelay = 7 days;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name())),
                keccak256(bytes("1")),
                _getChainId(),
                address(this)
            )
        );
        PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

        // Initial mint
        uint256 propsTreasuryAmount = _amount.mul(propsTreasuryMintPercentage).div(1e6);
        uint256 ownerAmount = _amount.sub(propsTreasuryAmount);

        _mint(propsTreasury, propsTreasuryAmount);
        _mint(_owner, ownerAmount);

        lastMint = block.timestamp;
    }

    /**
     * @dev Mint additional tokens according to the current inflation rate.
     *      The amount of tokens to get minted is determined by both the last
     *      mint time and the inflation rate ((`currentTime` - `lastMint`) * `inflationRate`).
     */
    function mint() external onlyOwner {
        // If the delay for the new inflation rate passed, update the inflation rate
        if (block.timestamp.sub(lastInflationRateChange) > inflationRateChangeDelay) {
            inflationRate = pendingInflationRate;
        }

        uint256 amount = inflationRate.mul(block.timestamp.sub(lastMint));
        if (amount != 0) {
            uint256 propsTreasuryAmount = amount.mul(propsTreasuryMintPercentage).div(1e6);
            uint256 ownerAmount = amount.sub(propsTreasuryAmount);

            _mint(propsTreasury, propsTreasuryAmount);
            _mint(owner(), ownerAmount);

            lastMint = block.timestamp;
        }
    }

    /**
     * @dev Set a new inflation rate. Once a new inflation rate is set, it
     *      takes some time before it goes into effect (the delay is determined
     *      by `inflationRateChangeDelay`).
     * @param _inflationRate The new inflation rate
     */
    function changeInflationRate(uint256 _inflationRate) external onlyOwner {
        pendingInflationRate = _inflationRate;
        lastInflationRateChange = block.timestamp;

        emit InflationRateChanged(inflationRate, pendingInflationRate);
    }

    /**
     * @dev Recover tokens accidentally sent to this contract.
     * @param _token The address of the token to be recovered
     * @param _to The address to recover the tokens for
     * @param _amount The amount to recover
     */
    function recoverTokens(
        IERC20Upgradeable _token,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        require(_to != address(0), "Cannot transfer to address zero");

        uint256 balance = _token.balanceOf(address(this));
        require(_amount <= balance, "Cannot transfer more than balance");

        _token.safeTransfer(_to, _amount);
    }

    /**
     * @dev Allows for approvals to be made via off-chain signatures.
     * @param _owner The approver of the tokens
     * @param _spender The spender of the tokens
     * @param _amount Approved amount
     * @param _deadline Approval deadline
     * @param _v Part of signature
     * @param _r Part of signature
     * @param _s Part of signature
     */
    function permit(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(_deadline >= block.timestamp, "Permit expired");

        bytes32 digest =
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR,
                    keccak256(
                        abi.encode(
                            PERMIT_TYPEHASH,
                            _owner,
                            _spender,
                            _amount,
                            nonces[_owner]++,
                            _deadline
                        )
                    )
                )
            );

        address recoveredAddress = ecrecover(digest, _v, _r, _s);
        require(recoveredAddress != address(0) && recoveredAddress == _owner, "Invalid signature");

        _approve(_owner, _spender, _amount);
    }

    function _getChainId() internal pure returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }

    /***************************************
                      ERC20
    ****************************************/

    bool public paused;
    mapping(address => uint8) public addressesWhitelist;

    mapping(address => uint256) private _balances;

    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    // solhint-disable-next-line func-name-mixedcase
    function __ERC20_init(string memory name_, string memory symbol_) internal {
        _name = name_;
        _symbol = symbol_;
        _decimals = 18;
    }

    /// @dev Modifier for disabling transfers when the token is paused.
    modifier whenNotPaused() {
        require(!paused || addressesWhitelist[msg.sender] != 0, "Paused");
        _;
    }

    /// @dev Mark the token as non-transferrable.
    function pause() public override onlyOwner {
        require(!paused, "Already paused");
        paused = true;
    }

    /// @dev Whitelist an address for transfers.
    function whitelistAddress(address _account) public override onlyOwner {
        require(addressesWhitelist[_account] == 0, "Already whitelisted");
        addressesWhitelist[_account] = 1;
    }

    /// @dev Blacklist an address for transfers.
    function blacklistAddress(address _account) external override onlyOwner {
        require(addressesWhitelist[_account] != 0, "Already blacklisted");
        addressesWhitelist[_account] = 0;
    }

    /// @dev Returns the name of the token.
    function name() public view returns (string memory) {
        return _name;
    }

    /// @dev Returns the symbol of the token, usually a shorter version of the name.
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     *      For example, if `decimals` equals `2`, a balance of `505` tokens should
     *      be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     *      Tokens usually opt for a value of 18, imitating the relationship between
     *      Ether and Wei. This is the value {ERC20} uses, unless {_setupDecimals} is
     *      called.
     *
     *      NOTE: This information is only used for _display_ purposes: it in
     *      no way affects any of the arithmetic of the contract, including
     *      {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }

    /**
     * @dev The total supply consists of both the already minted tokens and the tokens
     *      that are available to mint.
     */
    function totalSupply() public view override returns (uint256) {
        if (block.timestamp.sub(lastInflationRateChange) > inflationRateChangeDelay) {
            // If the delay for the new inflation rate passed, use that in the calculation
            return _totalSupply.add(pendingInflationRate.mul(block.timestamp.sub(lastMint)));
        } else {
            // Otherwise, use the old inflation rate since that is the active one
            return _totalSupply.add(inflationRate.mul(block.timestamp.sub(lastMint)));
        }
    }

    /// @dev See {IERC20-balanceOf}.
    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     *      Requirements:
     *      - `recipient` cannot be the zero address
     *      - the caller must have a balance of at least `amount`
     */
    function transfer(address recipient, uint256 amount)
        public
        override
        whenNotPaused
        returns (bool)
    {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    /// @dev See {IERC20-allowance}.
    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     *      Requirements:
     *      - `spender` cannot be the zero address
     */
    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     *      Emits an {Approval} event indicating the updated allowance. This is not
     *      required by the EIP. See the note at the beginning of {ERC20}.
     *
     *      Requirements:
     *      - `sender` and `recipient` cannot be the zero address
     *      - `sender` must have a balance of at least `amount`
     *      - the caller must have allowance for ``sender``'s tokens of at least `amount`
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override whenNotPaused returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(
            sender,
            msg.sender,
            _allowances[sender][msg.sender].sub(amount, "ERC20: transfer amount exceeds allowance")
        );
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     *      This is an alternative to {approve} that can be used as a mitigation for
     *      problems described in {IERC20-approve}.
     *
     *      Emits an {Approval} event indicating the updated allowance.
     *
     *      Requirements:
     *      - `spender` cannot be the zero address
     */
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        _approve(msg.sender, spender, _allowances[msg.sender][spender].add(addedValue));
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     *      This is an alternative to {approve} that can be used as a mitigation for
     *      problems described in {IERC20-approve}.
     *
     *      Emits an {Approval} event indicating the updated allowance.
     *
     *      Requirements:
     *      - `spender` cannot be the zero address
     *      - `spender` must have allowance for the caller of at least `subtractedValue`
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        _approve(
            msg.sender,
            spender,
            _allowances[msg.sender][spender].sub(
                subtractedValue,
                "ERC20: decreased allowance below zero"
            )
        );
        return true;
    }

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     *      This is internal function is equivalent to {transfer}, and can be used to
     *      e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     *      Emits a {Transfer} event.
     *
     *      Requirements:
     *      - `sender` cannot be the zero address
     *      - `recipient` cannot be the zero address
     *      - `sender` must have a balance of at least `amount`
     */
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");
        _balances[sender] = _balances[sender].sub(amount, "ERC20: transfer amount exceeds balance");
        _balances[recipient] = _balances[recipient].add(amount);
        emit Transfer(sender, recipient, amount);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     *       the total supply.
     *
     *       Emits a {Transfer} event with `from` set to the zero address.
     *
     *       Requirements:
     *       - `to` cannot be the zero address
     */
    function _mint(address account, uint256 amount) internal {
        require(account != address(0), "ERC20: mint to the zero address");
        _totalSupply = _totalSupply.add(amount);
        _balances[account] = _balances[account].add(amount);
        emit Transfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the total supply.
     *
     *      Emits a {Transfer} event with `to` set to the zero address.
     *
     *      Requirements:
     *      - `account` cannot be the zero address
     *      - `account` must have at least `amount` tokens
     */
    function _burn(address account, uint256 amount) internal {
        require(account != address(0), "ERC20: burn from the zero address");
        _balances[account] = _balances[account].sub(amount, "ERC20: burn amount exceeds balance");
        _totalSupply = _totalSupply.sub(amount);
        emit Transfer(account, address(0), amount);
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     *      This internal function is equivalent to `approve`, and can be used to
     *      e.g. set automatic allowances for certain subsystems, etc.
     *
     *      Emits an {Approval} event.
     *
     *      Requirements:
     *      - `owner` cannot be the zero address
     *      - `spender` cannot be the zero address
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}
