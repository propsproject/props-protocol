// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

interface IPropsToken {
    function maxTotalSupply() external view returns (uint256);

    function mint(address _account, uint256 _amount) external;

    function permit(
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external;
}
