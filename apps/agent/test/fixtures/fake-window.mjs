// Fake «powershell.exe» for the tests of the GUI host: it relays its stdin and stdout to a TCP connection opened by
// the test, which plays the window. Like the real window, it ends when its stdin ends or the test hangs up.
import { connect } from 'node:net';
import process from 'node:process';

const socket = connect(Number(process.argv[2]), '127.0.0.1');
process.stdin.pipe(socket);
socket.pipe(process.stdout);
process.stdin.on('end', () => process.exit(0));
socket.on('close', () => process.exit(0));
socket.on('error', () => process.exit(3));
