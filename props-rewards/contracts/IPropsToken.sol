pragma solidity ^0.5.0;

/**
 * @title PropsToken Interface for PropsRewards
 * @dev Interface for only function needed by PropsRewards
 *
 */

interface IPropsToken {

    function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external;
    function mint(address account, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}