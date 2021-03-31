// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";

interface IPermit {
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

/**
 * @title  TransferProxy
 * @author Props
 */
contract TransferProxy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Provides support for meta-transaction transfers via permits.
     *      Users can simply sign a permit, while an external address can
     *      trigger a transfer to any address by using the permit.
     */
    function transferWithPermit(
        address _token,
        address _recipient,
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        IPermit(_token).permit(_owner, _spender, _amount, _deadline, _v, _r, _s);
        IERC20Upgradeable(_token).safeTransferFrom(_owner, address(this), _amount);
        IERC20Upgradeable(_token).safeTransfer(_recipient, _amount);
    }
}
