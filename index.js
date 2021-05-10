const CONFIG = require('./config.js')
const cookieSession = require('cookie-session')

const express = require('express')
const app = express()

const bodyParser = require('body-parser');

const passport = require('passport')
const CustomStrategy = require('passport-custom').Strategy
const { authenticate } = require('ldap-authentication')

const http = require('http').Server(app)
const io = require('socket.io')(http)
const ldap = require('ldapjs');
var ssha = require('node-ssha256');

app.use(bodyParser.json());
app.use(express.static('public'))
const { v4: uuidv4 } = require('uuid');

passport.use('ldap', new CustomStrategy(
  async function (req, done) {
    try {
      if (!req.body.username || !req.body.password) {
        throw new Error('username and password are not provided')
      }
      // construct the parameter to pass in authenticate() function
      let ldapBaseDn = CONFIG.ldap.dn
      let options = {
        ldapOpts: {
          url: CONFIG.ldap.url
        },
        // note in this example it only use the user to directly
        // bind to the LDAP server. You can also use an admin
        // here. See the document of ldap-authentication.
        userDn: `cn=${req.body.username},${ldapBaseDn}`,
        userPassword: req.body.password,
        userSearchBase: ldapBaseDn,
        usernameAttribute: 'cn',
        username: req.body.username
      }
      // ldap authenticate the user
      let user = await authenticate(options)
      // success
      done(null, user)
    } catch (error) {
      // authentication failure
      done(error, null)
    }
  }
))

// passport requires this
passport.serializeUser(function (user, done) {
  done(null, user);
})
// passport requires this
passport.deserializeUser(function (user, done) {
  done(null, user);
})
// passport requires a session
var sessionMiddleWare = cookieSession({
  name: 'session',
  keys: ['keep the secret only to yourself'],
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
})

// The order of the following middleware is very important for passport!!
app.use(bodyParser.urlencoded({ extended: true }))
app.use(sessionMiddleWare)
// passport requires these two
app.use(passport.initialize())
app.use(passport.session())

// web page template
app.set('view engine', 'pug')


// user post username and password
app.post('/login',
  passport.authenticate('ldap', { failureRedirect: '/login' }),
  function (req, res) {
    res.redirect('/success');
  }
)
// success page
app.get('/success', (req, res) => {
  let user = req.user

  res.redirect('/')
})
// passport standard logout call.
app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
})
// the login page
app.get('/signin', function (req, res) {
  res.render('signin', { title: 'Hey', message: 'Hello there!' })
})
app.get('/signup', function (req, res) {
  res.render('index', { title: 'Hey', message: 'Hello there!' })
})

app.post('/signup', async (req, res) => {
 
  const client = await ldap.createClient({
    url: ['ldap://127.0.0.1:10389', 'ldap://127.0.0.2:10389']
  });

  var newDN = `cn=${req.body.username},ou=users,ou=system`;
  var newUser = {
    cn: req.body.username,
    sn: req.body.name,
    uid: uuidv4(),
    mail: req.body.email,
    objectClass: 'inetOrgPerson',
    userPassword: ssha.create(req.body.password)
  }
  client.bind('uid=admin,ou=system', 'secret', (err) => {
    if (err) {
        console.log("error in connection")
    }
    else {
        console.log("connection established");
        client.add(newDN, newUser,(err) => {
          if(err)
          console.log(err)
          else
          console.log("user added")
        });
    }
});

})






io.on('connection', (socket) => {
  console.log(`User Connected - Socket ID ${socket.id}`)
  // Store the room that the socket is connected to
  let currentRoom = null

  /** Process a room join request. */
  socket.on('JOIN', (roomName) => {
    // Get chatroom info
    let room = io.sockets.adapter.rooms[roomName]

    // Reject join request if room already has more than 1 connection
    if (room && room.length > 1) {
      // Notify user that their join request was rejected
      io.to(socket.id).emit('ROOM_FULL', null)

      // Notify room that someone tried to join
      socket.broadcast.to(roomName).emit('INTRUSION_ATTEMPT', null)
    } else {
      // Leave current room
      socket.leave(currentRoom)

      // Notify room that user has left
      socket.broadcast.to(currentRoom).emit('USER_DISCONNECTED', null)

      // Join new room
      currentRoom = roomName
      socket.join(currentRoom)

      // Notify user of room join success
      io.to(socket.id).emit('ROOM_JOINED', currentRoom)

      // Notify room that user has joined
      socket.broadcast.to(currentRoom).emit('NEW_CONNECTION', null)
    }
  })

  /** Broadcast a received message to the room */
  socket.on('MESSAGE', (msg) => {
    console.log(`New Message - ${msg}`)
    socket.broadcast.to(currentRoom).emit('MESSAGE', msg)
  })

  socket.on('PUBLIC_KEY', (key) => {
    socket.broadcast.to(currentRoom).emit('PUBLIC_KEY', key)
  })

  socket.on('disconnect', () => {
    socket.broadcast.to(currentRoom).emit('user disconnected', null)
  })


})




















// Start server
let port = 3000
console.log(`app is listening on port ${port}`)
http.listen(port, '127.0.0.1')