const shell = require('shelljs')
const fs = require('fs')
const app = require('express')()
const shortid = require('shortid');
const base64 = require('base-64');
const crypto = require('crypto');
const dynamo = require('dynamodb');
const bodyParser = require('body-parser')
const Joi = require('@hapi/joi');
const EthCrypto = require('eth-crypto');
const sha256 = require('sha256')
const btoa = require('btoa');
const eccrypto = require("eccrypto");

const networkId = process.env.NETWORK_ID
const memberId = process.env.CORE_PEER_LOCALMSPID
const region = process.env.AWS_REGION
const key = process.env.AWS_KEY
const secret_key = process.env.AWS_SECRET_KEY
const username = process.env.CA_USERNAME
const password = process.env.CA_PASSWORD
const orderer = process.env.ORDERER_URL
const peer = process.env.CORE_PEER_ADDRESS

let caEndPoint = null

shell.cd('/home/crypto')

dynamo.AWS.config.update({region: region});
app.use(bodyParser.json())
app.use(cors())

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    shell.exec(cmd, {silent: true}, function(code, stdout, stderr) {
      if(code !== 0) {
        reject(stderr)
      } else {
        resolve(stdout)
      }
    })
  })
}

(async () => {
  try {
    shell.exec(`aws configure set aws_access_key_id ${key}`)
    shell.exec(`aws configure set aws_secret_access_key ${secret_key}`)
    shell.exec(`aws configure set region ${region}`)
    
    let output = await runCommand(`aws managedblockchain get-member --network-id ${networkId} --member-id ${memberId}`)
    output = JSON.parse(output)

    caEndPoint = output.Member.FrameworkAttributes.Fabric.CaEndpoint

    if (!fs.existsSync(`/home/crypto/admin-msp`)) {
      shell.exec(`aws s3 cp s3://us-east-1.managedblockchain/etc/managedblockchain-tls-chain.pem  /home/crypto/managedblockchain-tls-chain.pem`)
      shell.exec(`fabric-ca-client enroll -u https://${username}:${password}@${caEndPoint} --tls.certfiles /home/crypto/managedblockchain-tls-chain.pem -M /home/crypto/admin-msp`)
      shell.exec(`cp -r admin-msp/signcerts admin-msp/admincerts`)

      const configtx = `
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
                    # DefaultOrg defines the organization which is used in the sampleconfig
                    # of the fabric.git development environment
                Name: ${memberId}
                    # ID to load the MSP definition as
                ID: ${memberId}
                MSPDir: /home/crypto/admin-msp
                    # AnchorPeers defines the location of peers which can be used
                    # for cross org gossip communication.  Note, this value is only
                    # encoded in the genesis block in the Application section context    
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
            OneOrgChannel:
                Consortium: AWSSystemConsortium
                Application:
                    <<: *ApplicationDefaults
                    Organizations:
                        - *Org1
      `

      fs.writeFileSync('./configtx.yaml', configtx)
    }
  } catch(e) {
    console.log(e)
    process.exit();
  }
})()

let User = dynamo.define('User', {
  hashKey : 'id',
  timestamps : true,
  schema : {
    id: Joi.string(),
    metadataEncrypted: Joi.string(),
    publicKey: Joi.string(),
    capsule: Joi.string()
  }
});

let PREKey = dynamo.define('PREKey', {
  hashKey : 'combineKey',
  schema : {
    combineKey: Joi.string(),
    userPublicKey: Joi.string(),
    preKey: Joi.string(),
    serviceProviderPublicKey: Joi.string()
  }
});

dynamo.createTables(function(err) {
  if (err) {
    console.log('Error creating tables: ', err);
  } else {
    console.log('Tables has been created');
  }
});

async function insertUser({id, metadataEncrypted, publicKey, capsule}) {
  return new Promise((resolve, reject) => {
    User.create({id, metadataEncrypted, publicKey, capsule}, function (err) {
      if(err) {
        reject(err)
      } else {
        resolve()
      }
    });
  })
}

async function insertPREKey({userPublicKey, serviceProviderPublicKey, preKey}) {
  return new Promise((resolve, reject) => {
    PREKey.create({combineKey: `${userPublicKey}_${serviceProviderPublicKey}`, userPublicKey, preKey, serviceProviderPublicKey}, function (err) {
      if(err) {
        reject(err)
      } else {
        resolve()
      }
    });
  })
}

async function getUser(id) {
  return new Promise((resolve, reject) => {
    User.query(id).exec((err, user) => {
      if(err || !user.Count) {
        reject(err)
      } else {
        resolve({
          id, 
          metadataEncrypted: user.Items[0].get("metadataEncrypted"), 
          publicKey: user.Items[0].get("publicKey"), 
          capsule: user.Items[0].get("capsule")
        })
      }
    });
  })
} 

async function getPREKey(publicKey, serviceProviderPublicKey) {
  return new Promise((resolve, reject) => {
    PREKey.query(`${publicKey}_${serviceProviderPublicKey}`).exec((err, data) => {
      if(err || !data.Count) {
        reject(err)
      } else {
        resolve({
          userPublicKey: data.Items[0].get("userPublicKey"),
          preKey: data.Items[0].get("preKey"),
          serviceProviderPublicKey: data.Items[0].get("serviceProviderPublicKey")
        })
      }
    });
  })
} 

function hexToBase64(str) {
  return btoa(String.fromCharCode.apply(null,
    str.replace(/\r|\n/g, "").replace(/([\da-fA-F]{2}) ?/g, "0x$1 ").replace(/ +$/, "").split(" ")));
}

app.post('/createUser', async (req, res) => {
  let identity = EthCrypto.createIdentity()
  let privateKey = identity.privateKey.substring(2)
  let publicKey = EthCrypto.publicKey.compress(identity.publicKey)
  let id = shortid.generate()

  let name = req.body.name;
  let age = req.body.age;
  let birthPlace = req.body.birthPlace;

  let metadata = {name, age, birthPlace}

  try {
    let base64PublicKey = Buffer.from(publicKey, 'hex').toString("base64")
    let base64Metadata = base64.encode(JSON.stringify(metadata))
    let result = await runCommand(`python3 /home/app/src/crypto-operations/encrypt.py ${base64PublicKey} '${base64Metadata}'`)
    result = result.split(" ")
    let metadataEncrypted = result[0].substr(2).slice(0, -1)

    let capsule = result[1].substr(2).slice(0, -2)

    let metadataHash = sha256(JSON.stringify(metadata))

    await insertUser({id, metadataEncrypted, publicKey, capsule})
    await runCommand(`peer chaincode invoke -n identity -c '{"Args":["issueIdentity", "${id}", "${publicKey}", "${metadataHash}"]}' -C identity -o $ORDERER_URL --cafile /home/crypto/managedblockchain-tls-chain.pem --tls`)

    res.send({message: {privateKey, id}})
  } catch(e) {
    res.send({message: e, error: true})
  }
})

app.post('/addServiceProvider', async (req, res) => {
  let mspid = req.body.mspid
  let name = req.body.name
  let publicKey = req.body.publicKey

  try {
    await runCommand(`peer chaincode invoke -n identity -c '{"Args":["addServiceProvider", "${mspid}", "${name}", "${publicKey}"]}' -C identity -o $ORDERER_URL --cafile /home/crypto/managedblockchain-tls-chain.pem --tls`)
    res.send({message: "Added"})
  } catch(e) {
    res.send({message: e, error: true})
  }
})

app.post('/grantAccess', async (req, res) => {
  let serviceProviderPublicKey = req.body.serviceProviderPublicKey
  let privateKey = req.body.privateKey
  let id = req.body.id

  try {
    let preKey = await runCommand(`python3 /home/app/src/crypto-operations/generate-re-encryptkey.py ${hexToBase64(privateKey)} ${hexToBase64(serviceProviderPublicKey)}`)
    let user = await getUser(id)

    await insertPREKey({preKey: preKey.substring(0, preKey.length - 1), serviceProviderPublicKey, userPublicKey: user.publicKey})

    res.send({message: "Access Granted"})
  } catch(e) {
    console.log(e)
    res.send({message: e, error: true})
  }
})

app.post('/getUserMetadata', async (req, res) => {
  let signature = req.body.signature
  let id = req.body.id
  let publicKey = req.body.publicKey

  let message = JSON.stringify({publicKey, id})
  message = crypto.createHash("sha256").update(message).digest()

  try {
    await eccrypto.verify(Buffer.from(publicKey, 'hex'), message, Buffer.from(signature, 'hex'))

    let user = await getUser(id)

    let userBlockchainInfo = await runCommand(`peer chaincode query -n identity -c '{"Args":["getIdentity","${id}"]}' -C identity -o $ORDERER_URL --cafile /home/crypto/managedblockchain-tls-chain.pem --tls`)
    userBlockchainInfo = JSON.parse(userBlockchainInfo)

    let preKey = await getPREKey(userBlockchainInfo.publicKey, publicKey)

    res.send({message: {user, preKey}})
  } catch(e) {
    console.log(e)
    res.send({message: e, error: true})
  }
})

app.post('/signMessage', async (req, res) => {
  let privateKey = req.body.privateKey
  let message = req.body.message //this should be a JSON string

  try {
    let messageHash =  crypto.createHash("sha256").update(message).digest()
    
    eccrypto.sign(Buffer.from(privateKey, 'hex'), messageHash).then((signature) => {
      res.send({message: signature.toString('hex')})
    })
  } catch(e) {
    res.send({message: e, error: true})
  }
})

app.listen(3000, () => console.log('API Server Running'))