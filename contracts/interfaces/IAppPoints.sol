// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

interface IAppPoints {
    function pause() external;

    function unpause() external;

    function whitelistForTransfers(address _account) external;

    function blacklistForTransfers(address _account) external;
}
