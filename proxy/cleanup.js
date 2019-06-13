function noOp() {};

exports.Cleanup = function Cleanup(handler) {

    exitHandler = handler || noOp;

    process.on('cleanup', exitHandler.bind(null,{cleanup:true}));

    //do something when app is closing
    process.on('exit', exitHandler.bind(null,{cleanup:true}));

    //catches ctrl+c event
    process.on('SIGINT', exitHandler.bind(null, {exit:true}));

    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
    process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

    // cathes Service termination (for example: systemctl stop rws-proxy)
    process.on('SIGTERM', exitHandler.bind(null, {exit:true}));

    //catches uncaught exceptions
    // process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

    //catch uncaught exceptions, trace, then exit normally
    process.on('uncaughtException', function(e) {
        console.log('Uncaught Exception...');
        console.log(e.stack);
        process.exit(99);
    });
};
