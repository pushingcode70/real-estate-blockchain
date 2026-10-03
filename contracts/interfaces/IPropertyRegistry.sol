// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPropertyRegistry {

    function isVerified(uint256 propertyID)
        external
        view
        returns (bool);

    function getPropertySubmitter(uint256 propertyID)
        external
        view
        returns (address);

    function getPropertyMetadataURI(uint256 propertyID)
        external
        view
        returns (string memory);
}