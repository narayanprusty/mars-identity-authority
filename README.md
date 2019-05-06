# mars-identity-authority

This is the REST APIs server for Identity Authority.

## Creating a Joint Channel

First ssh into the EC2 that's running the containers. Then access to shell of the containers using this command: `docker exec -i -t container_id /bin/bash`. Then create a channel with both authorities as members follow the below steps:

1. Run this command in working directory inside the docker container to create MSP directory representing property authority: `mkdir property-authority-msp && mkdir property-authority-msp/admincerts && mkdir property-authority-msp/cacerts` 

2. The copy the files from admincerts and cacerts directory of property authority container

3. Replace content of configtx.yaml with this:

```
################################################################################
#
#   Section: Organizations
#
#   - This section defines the different organizational identities which will
#   be referenced later in the configuration.
#
################################################################################
Organizations:
    - &Org1
            # member id defines the organization
        Name: m-LROTSFCSWBFRHPNTC7MWV6V7VQ
            # ID to load the MSP definition as
        ID: m-LROTSFCSWBFRHPNTC7MWV6V7VQ
            #msp dir of org1 in the docker container
        MSPDir: /home/admin-msp
            # AnchorPeers defines the location of peers which can be used
            # for cross org gossip communication.  Note, this value is only
            # encoded in the genesis block in the Application section context
        AnchorPeers:
            - Host:
              Port:
    - &Org2
        Name: m-L74IXPZKH5GE7AS55RKH2WYIRE
        ID: m-L74IXPZKH5GE7AS55RKH2WYIRE
        MSPDir: /home/property-authority-msp
        AnchorPeers:
            - Host:
              Port:

################################################################################
#
#   SECTION: Application
#
#   - This section defines the values to encode into a config transaction or
#   genesis block for application related parameters
#
################################################################################
Application: &ApplicationDefaults
        # Organizations is the list of orgs which are defined as participants on
        # the application side of the network
     Organizations:

################################################################################
#
#   Profile
#
#   - Different configuration profiles may be encoded here to be specified
#   as parameters to the configtxgen tool
#
################################################################################
Profiles:
    TwoOrgChannel:
        Consortium: AWSSystemConsortium
        Application:
            <<: *ApplicationDefaults
            Organizations:
                - *Org1
                - *Org2
```

> Add Member ID of the orgs for values Name and ID

4. Then run this command to generate the configtx peer block: `configtxgen -outputCreateChannelTx /home/mars.pb -profile TwoOrgChannel -channelID mars --configPath /home/`

5. Now create the channel using this command: `CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE=/home/managedblockchain-tls-chain.pem CORE_PEER_ADDRESS=$PEER_URL CORE_PEER_LOCALMSPID=$MEMBER_ID CORE_PEER_MSPCONFIGPATH=/home/admin-msp peer channel create -c mars -f /home/mars.pb -o $ORDERER_URL  --cafile /home/managedblockchain-tls-chain.pem --tls`

6. Join IdentityAuthority to the channel by running this command: `CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE=/home/managedblockchain-tls-chain.pem CORE_PEER_ADDRESS=$PEER_URL CORE_PEER_LOCALMSPID=$MEMBER_ID CORE_PEER_MSPCONFIGPATH=/home/admin-msp peer channel join -b /home/mars.block -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem --tls`

7. Join PropertyAuthority to the channel by running this command: `CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE=/home/managedblockchain-tls-chain.pem CORE_PEER_ADDRESS=$PEER_URL CORE_PEER_LOCALMSPID=$MEMBER_ID CORE_PEER_MSPCONFIGPATH=/home/admin-msp peer channel fetch 0 mars.block --tls -c mars -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem` and `CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE=/home/managedblockchain-tls-chain.pem CORE_PEER_ADDRESS=$PEER_URL CORE_PEER_LOCALMSPID=$MEMBER_ID CORE_PEER_MSPCONFIGPATH=/home/admin-msp peer channel join -b /home/mars.block -o $ORDERER_URL --cafile /home/managedblockchain-tls-chain.pem --tls`