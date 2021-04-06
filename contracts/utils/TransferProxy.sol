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
     *      Users can simply sign a permit together with a recipient address,
     *      while an external address can trigger a transfer to the recipient
     *      by relaying the two signatures.
     */
    function transferWithPermit(
        address _token,
        address _recipient,
        uint8 _recipientV,
        bytes32 _recipientR,
        bytes32 _recipientS,
        address _owner,
        address _spender,
        uint256 _amount,
        uint256 _deadline,
        uint8 _permitV,
        bytes32 _permitR,
        bytes32 _permitS
    ) external {
        // Avoid 'Stack too deep' errors
        {
            bytes32 recipientHash = keccak256(abi.encodePacked(_recipient));
            require(
                ecrecover(
                    keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", recipientHash)),
                    _recipientV,
                    _recipientR,
                    _recipientS
                ) != _owner,
                "Invalid recipient signature"
            );
        }

        IPermit(_token).permit(_owner, _spender, _amount, _deadline, _permitV, _permitR, _permitS);
        IERC20Upgradeable(_token).safeTransferFrom(_owner, _recipient, _amount);
    }
}
