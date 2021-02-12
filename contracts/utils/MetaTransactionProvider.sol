// SPDX-License-Identifier: MIT

pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

// TODO: Add docs
abstract contract MetaTransactionProvider {
    using SafeMathUpgradeable for uint256;

    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

    struct MetaTransaction {
        uint256 nonce;
        address from;
        bytes functionSignature;
        uint256 deadline;
    }

    /**************************************
                     FIELDS
    ***************************************/

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public DOMAIN_SEPARATOR;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 public META_TRANSACTION_TYPEHASH;

    mapping(address => uint256) public nonces;

    /**************************************
                     EVENTS
    ***************************************/

    event MetaTransactionExecuted(address from, address relayer, bytes functionSignature);

    /***************************************
                   INITIALIZER
    ****************************************/

    // solhint-disable-next-line func-name-mixedcase
    function __MetaTransactionProvider_init(
        string memory _name,
        string memory _version,
        // The chain id must be correspond to the chain id of the underlying base Ethereum network
        // This way, users won't have to change networks in order to be able to sign transactions
        uint256 _chainId
    ) public {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    bytes(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    )
                ),
                keccak256(bytes(_name)),
                keccak256(bytes(_version)),
                _chainId,
                address(this)
            )
        );

        META_TRANSACTION_TYPEHASH = keccak256(
            bytes(
                "MetaTransaction(uint256 nonce,address from,bytes functionSignature,uint256 deadline)"
            )
        );
    }

    function executeMetaTransaction(
        address _from,
        bytes memory _functionSignature,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public payable returns (bytes memory) {
        require(_deadline >= block.timestamp, "Signature expired");

        bytes4 destinationFunctionSignature = _convertBytesToBytes4(_functionSignature);
        require(destinationFunctionSignature != msg.sig, "Invalid function signature");

        MetaTransaction memory metaTransaction =
            MetaTransaction({
                nonce: nonces[_from],
                from: _from,
                functionSignature: _functionSignature,
                deadline: _deadline
            });

        require(_verify(_from, metaTransaction, _r, _s, _v), "Invalid signer");
        nonces[_from] = nonces[_from].add(1);

        // Append `_from` at the end to extract it from calling context
        (bool success, bytes memory returnData) =
            // solhint-disable-next-line avoid-low-level-calls
            address(this).call(abi.encodePacked(_functionSignature, _from));
        require(success, "Unsuccessfull call");

        emit MetaTransactionExecuted(_from, msg.sender, _functionSignature);
        return returnData;
    }

    /***************************************
                     HELPERS
    ****************************************/

    function _toEIP712Digest(bytes32 _messageDigest) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, _messageDigest));
    }

    function _convertBytesToBytes4(bytes memory _inBytes) internal pure returns (bytes4) {
        if (_inBytes.length == 0) {
            return 0x0;
        }

        bytes4 outBytes;
        assembly {
            outBytes := mload(add(_inBytes, 32))
        }
        return outBytes;
    }

    function _verify(
        address _from,
        MetaTransaction memory _metaTransaction,
        bytes32 _r,
        bytes32 _s,
        uint8 _v
    ) internal view returns (bool) {
        address signer =
            ecrecover(_toEIP712Digest(_hashMetaTransaction(_metaTransaction)), _v, _r, _s);
        require(signer != address(0), "Invalid signature");
        return signer == _from;
    }

    function _hashMetaTransaction(MetaTransaction memory _metaTransaction)
        internal
        view
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    META_TRANSACTION_TYPEHASH,
                    _metaTransaction.nonce,
                    _metaTransaction.from,
                    keccak256(_metaTransaction.functionSignature),
                    _metaTransaction.deadline
                )
            );
    }

    function msgSender() internal view returns (address) {
        if (msg.sender == address(this)) {
            bytes memory array = msg.data;
            uint256 index = msg.data.length;

            address _sender;
            assembly {
                // Load the 32 bytes word from memory with the address on the lower 20 bytes, and mask those
                _sender := and(mload(add(array, index)), 0xffffffffffffffffffffffffffffffffffffffff)
            }
            return _sender;
        } else {
            return msg.sender;
        }
    }
}
