// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.7.0;

interface IPropsController {
    function saveAppToken(address _appToken, address _appTokenStaking) external;
}
