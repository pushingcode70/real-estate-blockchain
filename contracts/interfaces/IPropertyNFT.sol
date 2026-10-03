// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface  IPropertyNFT {
     function ownerOf(uint256 tokenID)
     external
     view
     returns (address);

      function getTokenForProperty(uint256 propertyID)
        external
        view
        returns (uint256);

     function safeTransferFrom(
        address from,
        address to,
        uint256 tokenID
     ) external;
}