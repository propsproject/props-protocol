// SPDX-License-Identifier: MIT

pragma solidity 0.6.8;

interface IPropsController {
    function saveAppToken(address _appToken, address _appTokenStaking) external;
}
