'use strict';

const fs = require('fs');
const firebase = require("firebase");
require("firebase/firestore");
const logger = require("./logger");
const AppClient = require("./app_client");

const FieldValue = firebase.firestore.FieldValue

// firebase.firestore.setLogLevel("debug");

///////////////////////////////////////////////////////////////////////////////
//
// Firebase Client 
//
///////////////////////////////////////////////////////////////////////////////
module.exports  = class FirebaseClientEmail {
    constructor ( params ) {

        if( params == undefined ) {
            logger.error('No Configuration parameters to initialize Firebase Client');
        }
        this.params_ = params;

        this.type_ = params.type || 'type-v1';

        logger.debug('Firebase Config file path: ' 
                + params.firebase_client_config_file );
        let firebase_config = JSON.parse(require('fs')
                .readFileSync(params.firebase_client_config_file, 'utf8'));
        logger.debug('Firebase Config : ' + JSON.stringify(firebase_config ));

        // If the server time diff value of the message is greater than 
        // the specified threshold, the message is ignored.
        this.message_timeout_ = params.firebase_message_timeout;
        logger.debug('Timeout: ' + this.message_timeout_);

        this.myDeviceId_ = params.deviceId;
        logger.debug('My Device ID: ' + this.myDeviceId_);

        // firebase App Initialization
        firebase.initializeApp(firebase_config);

        // Short cut to firebase auth and database
        this.auth_ = firebase.auth();
        this.database_ = firebase.firestore();

        const settings = {timestampsInSnapshots: true};
        this.database_.settings(settings);

        firebase.auth().onAuthStateChanged( this.onAuthStateChanged_.bind(this));

        // signin to google firebase with email/password method.
        firebase.auth().signInWithEmailAndPassword(params.email, params.password).then(function(result) {
            // signin successed
            logger.info('Signing In successful.');
            logger.debug('User uid: ' + result.uid );
            logger.info('User email: ' + result.email );
            logger.info('User emailVerified: ' + result.emailVerified );
        }).catch(function(error) {
            // Handle Errors here.
            let errorCode = error.code;
            let errorMessage = error.message;
            // The email of the user's account used.
            let email = error.email;
            // The firebase.auth.AuthCredential type that was used.
            let credential = error.credential;
            logger.error(error);
        });
    }

    onAuthStateChanged_  (user) {
        if (user) {
            this.uid_ = user.uid;
            // User signed in!
            logger.info("AuthStatueChanged User : " + this.uid_ + " Signed In");
            this.initFirebaseClient();

        }  else {
            logger.info('AuthStatueChanged User : SignOut');
            if( this.uid_  ) {
                try {
                    this.unInitFirebaseClient();
                } catch(e){
                    logger.debug(e)
                }
            };
        };
    }

    initFirebaseClient () {

        this.app_client_ =  new AppClient(this.params_.url,
                this.sendDataseMessage.bind(this), 
                this.updateDeviceInfoSession.bind(this), this.myDeviceId_);
        this.deviceId_ = this.app_client_.getDeviceId();
        logger.info('App Client Device Id: ' + this.deviceId_);
        this.initDeviceInfo();

        // initialize the firebase server time offset
        // this.offsetRef_ = firebase.firestore().ref(".info/serverTimeOffset");
        this.serverTimeOffset_ = 0; // initial offset value is zero
        /*this.offsetRef_.on("value", function(snap) {
            this.serverTimeOffset_ = snap.val();
        }.bind(this));*/

        // start to listen the client message 
        this.messagesRef_ = this.database_.collection('messages').doc(this.uid_).collection(this.deviceId_);
        // this.messagesRef_ = this.database_.ref('messages/' + this.uid_ + '/' + this.deviceId_);
        // logger.debug('Message Ref: ' + this.messagesRef_ );
        // Make sure we remove all previous listeners.
        // this.messagesRef_.off();
        if (this.unsub_ != null) {
            this.unsub_();
            this.unsub_ = null;
        }

        let onNewDatabaseMessage = function(snap) {
            let val = snap.data();
            logger.debug(val);

            /*let val = snap.val();
            let messageTimeDiff = new Date().getTime() + this.serverTimeOffset_  -  val.timestamp;
            logger.debug('New DB: To: ' + val.to + ', did: ' + val.deviceid + 
                    ', rid: ' + val.roomid + ', cid: ' + val.clientid + 
                    ', Timstamp: ' + val.timestamp + '(' + messageTimeDiff + ')');*/
            // Make sure the timestamp is not timeed out and valid message.
            // to : 'device' : means message sent to device from server
            // to : 'server' : means message sent to server from device

            // only care about messages to device
            if( val.to == 'device' ) {

                // checking inside cause no timestamp on add
                let messageTimeDiff = new Date().getTime() - val.timestamp.toMillis();
                logger.debug('message Time Diff: ' + messageTimeDiff );

                // Make sure that message is not a message that has passed timeout.
                if( messageTimeDiff < this.message_timeout_ ){ 
                    // logger.debug('message Svr -> C: ' + val.message );
                    this.app_client_.doSendToDevice( val );
                } else {
                    logger.debug('Remove timeout message: ' + val.message );
                }
                // remove the current message
                snap.ref.delete();
            };
        }.bind(this);
        // this.messagesRef_.on('child_added', onNewDatabaseMessage.bind(this));
        this.unsub_ = this.messagesRef_.onSnapshot(docSnap => {
            docSnap.docChanges.forEach(change => {
                if (change.type === 'added') {
                    logger.debug('Child Added')
                    // logger.debug(change.doc)
                    onNewDatabaseMessage(change.doc);
                  }
            });
        }, err => {
            logger.debug('Encountered Error: ' + err)
        })

        // connect device
        // this.app_client_.deviceConnect();
    }

    initDeviceInfo () {
        // dbconn : firebase database connnection status
        //      'connected',
        //      'disconncted'
        //
        // session : connection between proxy and rpi-webrtc-streamer
        //      'connected'   
        //      'disconncted'
        //      'busy'
        //
        this.deviceInfo_ = {
            deviceid: String(this.deviceId_),
            dbconn: 'connected',
            session: 'available',
            title: this.params_.title,
            description: this.params_.description
        };
        // initialize presence reference
        this.presenceRef_ = this.database_.collection('devices').doc(this.uid_).collection(this.type_).doc(this.deviceId_);
        // this.presenceRef_ = this.database_.ref('devices/' + this.uid_ + '/' + this.deviceId_);

        // setting object for onDisconnect 
        // this.deviceInfo_.dbconn = 'disconnected';
        // this.deviceInfo_.session = 'disconnected';
        /*this.presenceRef_.update({
            deviceInfo: FieldValue.delete()
        });*/
        // this.presenceRef_.onDisconnect().remove();  // remove previous onDisconnect
        // this.presenceRef_.onDisconnect().set(this.deviceInfo_);

        // update current device Info 
        this.deviceInfo_.dbconn = 'disconnected';
        this.deviceInfo_.session = 'available'; // default init value
        // this.presenceRef_.update(this.deviceInfo_);
        this.presenceRef_.set({
            deviceInfo: this.deviceInfo_
        }).catch(error => {
            logger.debug('Presence Update error: ' + error)
        });
    }

    //  Updating Device Info ( database reference is '/devices/$uid/$deviceid' )
    // 
    // conn_status : 
    //      'connected' : WebSocket connected
    //      'disconnected' : WebSocket disconnected
    //      'session_connected' : streaming session connected
    //      'session_disconnected' : streaming session disconnected
    updateDeviceInfoSession (conn_status) {
        if( conn_status == this.previous_connection_status ) {
            // do not update when the conn_status is same as previous connection status
            return;
        };

        let  update_deviceinfo = {};

        // updating previous connection status with  new connection value
        this.previous_connection_status = conn_status;
        logger.info('AppClient Connection status : ' + conn_status );
        switch ( conn_status ) {
            case 'connected':
                update_deviceinfo.dbconn = 'connected';
                update_deviceinfo.update_timestamp = FieldValue.serverTimestamp();
                update_deviceinfo.session = 'busy';
                break;
            case 'disconnected':
                update_deviceinfo.dbconn = 'disconnected';
                update_deviceinfo.update_timestamp = FieldValue.serverTimestamp();
                update_deviceinfo.session = 'available';
                break;
            case 'session_connected':
                // update_deviceinfo.session = 'busy';
                // update_deviceinfo.access_timestamp = FieldValue.serverTimestamp();
                // break;
                return;
            case 'session_disconnected':
                // update_deviceinfo.session = 'available';
                // update_deviceinfo.access_timestamp = FieldValue.serverTimestamp();
                // break;
                return;
            case 'error':
                    update_deviceinfo.dbconn = 'disconnected';
                    update_deviceinfo.update_timestamp = FieldValue.serverTimestamp();
                    update_deviceinfo.session = 'available';
                    break;
            default:
                logger.error('Unknown AppClient Connection status: ' + conn_status );
                return;
        };
        // this.presenceRef_.update(update_deviceinfo);
        this.presenceRef_.set({
            deviceInfo: update_deviceinfo
        }, {merge: true});
    }


    unInitFirebaseClient () {
        this.deviceId_ = null;
        this.app_client_ =  null;
        if (this.unsub_ != null) {
            this.unsub_();
            this.unsub_ = null;
        }
        // this.messagesRef_.off();
        this.presenceRef_ = null;
        this.messagesRef_ = null;
    }

    sendDataseMessage (message) {
        if (this.auth_.currentUser) {
            // message.timestamp = new Date().getTime();
            message['timestamp'] = FieldValue.serverTimestamp();
            // message['timestamp'] = firebase.database.ServerValue.TIMESTAMP;
            this.messagesRef_.add(message);
        } else {
            logger.error('ERROR: user does not signed in.');
            return false;
        };
        return true;
    }

    closeDevice() {
        let x = null;
        logger.info("Close Device");
        if (this.presenceRef_ !== null) {
            logger.info("Removing Device");
            x = this.presenceRef_.delete();
            this.presenceRef_ = null;
        }
        if (this.unsub_ != null) {
            this.unsub_();
            this.unsub_ = null;
        }
        return x;
    }
};
