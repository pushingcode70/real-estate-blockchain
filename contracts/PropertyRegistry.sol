// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract PropertyRegistry is AccessControl {

//property starts as pending than verify
enum PropertyStatus {
    Pending,
    Verified
}

struct Property {

    uint256 propertyID;
    string registrationNumber;
    string metadataURI; //contains properties metadata
    bytes32 documentHash;  //hash of doc which will be onchain
    address submitter;
    PropertyStatus status; //current verfication status
    uint256 addedTimestamp;
}

//property counter
uint256 private nextPropertyID = 1;

//stores property struct aka info about property
mapping(uint256 =>Property) public properties;

//registration number hash -> propertyID
mapping(bytes32 => uint256) public propertyByRegistrationNumber; //REG-001->keccak256->hash->propertyByRegistrationNumber[hash] = propertyID

//emitted when a property is submitted..this is for frontend offchain opeartion ..fires an event for logging records that can be seen on frontend
event PropertySubmitted(uint256 indexed propertyID, address indexed submitter);

//emitted when verifier approves property   
event PropertyVerified(uint256 indexed propertyID, address indexed verifier);


constructor() {
//only admin can verifythe peroperty
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

}

function submitProperty(
    string  calldata registrationNumber, //calldata is special data location used to store function arguments sent in an external transaction call
    string calldata metadataURI,//someone registers a property you pass the registration number and IPFS URI as calldata
    bytes32 documentHash
) external returns (uint256 propertyID) {//external means func called from outside from a user's wallet via a frontend or another contract
    
    bytes32 registrationNumberHash = keccak256(bytes(registrationNumber));

    require(
        bytes(registrationNumber).length >0,
        "Invalid registration number"
    );

    require(
        propertyByRegistrationNumber[registrationNumberHash] == 0,
        "Property already registered"
    );

    propertyID = nextPropertyID;

    nextPropertyID++;

    //create and store the property
    properties[propertyID] = Property({
        propertyID: propertyID,
         registrationNumber: registrationNumber,
            metadataURI: metadataURI,
            documentHash: documentHash,
            submitter: msg.sender,
            status: PropertyStatus.Pending,
            addedTimestamp: block.timestamp
        });

        propertyByRegistrationNumber[registrationNumberHash] = propertyID; //record which property uses this registration number


        //record who submitted it 
        //msg.sender= wallet that called the submitProperty().
        emit PropertySubmitted(propertyID, msg.sender);
        }

//only an admin can verify a property
function verifyProperty(
    uint256 propertyID
)   external onlyRole(DEFAULT_ADMIN_ROLE) {

    //get the stored property
    Property storage property = properties[propertyID]; //property is local variable pointer of type Property..storage-->create a direct reference (pointer) to the actual data sitting on the blockchain 

    require(
        property.propertyID != 0,
        "Property does not exist"
    );

    require(
        property.status == PropertyStatus.Pending,
        "Property already verified"
    );

    property.status = PropertyStatus.Verified;

    emit PropertyVerified(propertyID, msg.sender);
}

function isVerified(uint256 propertyID)
    external
    view
    returns (bool)
{
    return properties[propertyID].status == PropertyStatus.Verified;
}

function getPropertySubmitter(uint256 propertyID)
    external
    view
    returns (address)
{
    return properties[propertyID].submitter;
}

function getPropertyMetadataURI(uint256 propertyID)
    external
    view
    returns (string memory)
{
    return properties[propertyID].metadataURI;
}
}


