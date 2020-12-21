// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

contract SPropsAppToken is Initializable, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;

    string private _name;
    string private _symbol;
    uint8 private _decimals;
    uint256 private _totalSupply;

    /// @notice Official record of token balances for each account
    mapping(address => uint256) internal _balances;

    /// @notice The standard EIP-20 transfer event
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function initialize() public initializer {
        OwnableUpgradeable.__Ownable_init();

        _name = "sPropsApp";
        _symbol = "sPropsApp";
        _decimals = 18;
        _totalSupply = 0;
    }

    /// @notice EIP-20 token name for this token
    function name() public view returns (string memory) {
        return _name;
    }

    /// @notice EIP-20 token symbol for this token
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /// @notice EIP-20 token decimals for this token
    function decimals() public view returns (uint8) {
        return _decimals;
    }

    /// @notice EIP-20 total token supply for this token
    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    /**
     * @notice Mint new tokens
     * @param dst The address of the destination account
     * @param amount The number of tokens to be minted
     */
    function mint(address dst, uint256 amount) public onlyOwner {
        require(dst != address(0), "Cannot mint to the zero address");

        // Mint the amount
        _totalSupply = _totalSupply.add(amount);

        // Transfer the amount to the destination account
        _balances[dst] = _balances[dst].add(amount);
        emit Transfer(address(0), dst, amount);
    }

    /**
     * @notice Burn existing tokens
     * @param src The address of the source account
     * @param amount The number of tokens to be burned
     */
    function burn(address src, uint256 amount) public onlyOwner {
        require(src != address(0), "Cannot burn from the zero address");

        // Burn the amount
        _totalSupply = _totalSupply.sub(amount);

        // Transfer the amount from the source account
        _balances[src] = _balances[src].sub(amount);
        emit Transfer(src, address(0), amount);
    }

    /**
     * @notice Get the number of tokens held by the `account`
     * @param account The address of the account to get the balance of
     * @return The number of tokens held
     */
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address, address) external pure returns (uint256) {
        revert("sPropsApp are not transferrable");
    }

    function approve(address, uint256) external pure returns (bool) {
        revert("sPropsApp are not transferrable");
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert("sPropsApp are not transferrable");
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external pure returns (bool) {
        revert("sPropsApp are not transferrable");
    }
}
