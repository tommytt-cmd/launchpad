// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply token. The whole supply is minted once, in the constructor.
/// There is no mint function, no owner, and no admin of any kind.
contract LaunchToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether; // 1B tokens, 18 decimals

    constructor(string memory name_, string memory symbol_, address recipient) ERC20(name_, symbol_) {
        _mint(recipient, TOTAL_SUPPLY);
    }
}
