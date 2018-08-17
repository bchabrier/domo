import * as passport from 'passport';
import * as passportLocal from 'passport-local';
var LocalStrategy = passportLocal.Strategy;
var RememberMeStrategy = require('passport-remember-me').Strategy;
import * as cookieParser from 'cookie-parser';
import * as ensureLogin from 'connect-ensure-login';
const flash = require('connect-flash');
import * as tokenMgr from '../lib/token';
import * as express from 'express';
import { IVerifyOptions } from 'passport-local';
var logger = require("tracer").colorConsole({
  dateformat: "dd/mm/yyyy HH:MM:ss.l",
  level: 3 //0:'test', 1:'trace', 2:'debug', 3:'info', 4:'warn', 5:'error'
});

class User {
  id: string
}

var _tokenMgr: typeof tokenMgr;
var _loginPath: string;

export function configure(app: express.Application,
  check: (user: string, pwd: string, done: (error: any, user?: any, options?: IVerifyOptions) => void) => void,
  findById: (user: string, cb: (err: Error, user: User) => void) => void,
  tokenMgr: typeof _tokenMgr, loginPath: string,
  loginContent: (req: express.Request, resp: express.Response) => void) {
  _tokenMgr = tokenMgr;
  _loginPath = loginPath;

  // Local Authentication strategy
  passport.use(new LocalStrategy(function (user: string, pwd: string, done: (error: any, user?: any, options?: IVerifyOptions) => void) {
    logger.info('LocalStrategy calling check');
    check(user, pwd, done);
  }));

  // Configure Passport authenticated session persistence.
  //
  // In order to restore authentication state across HTTP requests, Passport needs
  // to serialize users into and deserialize users out of the session.  The
  // typical implementation of this is as simple as supplying the user ID when
  // serializing, and querying the user record by ID from the database when
  // deserializing.
  passport.serializeUser(function (user: User, cb: (err: Error, user: string) => void) {
    logger.debug('serializeUser %j', user);
    cb(null, user.id);
  });

  passport.deserializeUser(function (id: string, cb) {
    logger.debug('deserializeUser', id);
    findById(id, function (err: Error, user: User) {
      if (err) {
        logger.debug('could not deserialize user', id);
        return cb(err);
      }
      if (user == null) {
        logger.debug('user not found:', user);
        // let's try the next deserializer
        cb('pass');
      } else {
        logger.debug('found user', user);
        cb(null, user);
      }
    });
  });

  // Remember Me cookie strategy
  //   This strategy consumes a remember me token, supplying the user the
  //   token was originally issued to.  The token is single-use, so a new
  //   token is then issued to replace it.
  passport.use(new RememberMeStrategy(
    function (token: string, done: (err: Error, user?: User | boolean) => void) {
      consumeRememberMeToken(token, function (err: Error, uid: string) {
        if (err) {
          logger.debug('Got error while consuming RememberMe token:', err);
          return done(err);
        }
        if (!uid) {
          logger.debug('Got no uid while consuming RememberMe token');
          return done(null, false);
        }

        logger.debug('Found uid while consuming RememberMe token:', uid);
        findById(uid, function (err, user) {
          if (err) {
            logger.debug('Found error while finding uid "', uid, '":', err);
            return done(err);
          }
          if (!user) {
            logger.debug('Didn\'t find user for uid "', uid, '"');
            return done(null, false);
          }
          logger.debug('Found user for uid "', uid, '":', user);
          return done(null, user);
        });
      });
    },
    issueToken
  ));

  app.use(flash());

  // Initialize Passport and restore authentication state, if any, from the
  // session.
  app.use(require('cookie-parser')());
  app.use(require('body-parser').urlencoded({ extended: true }));
  app.use(require('express-session')({ secret: 'my own passphrase', resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(passport.authenticate('remember-me'));


  app.get(loginPath, function (req, res) {
    //  res.json({ user: req.user, message: req.flash('error') });
    return loginContent(req, res);
  });

  // POST /login.html
  //   Use passport.authenticate() as route middleware to authenticate the
  //   request.  If authentication fails, the user will be redirected back to the
  //   login page.  Otherwise, the primary route function function will be called,
  //   which, in this example, will redirect the user to the home page.
  //
  //   curl -v -d "username=bob&password=secret" http://127.0.0.1:3000/login.html
  app.post(loginPath,
    function (req: express.Request, res: express.Response, next: express.NextFunction) {
      logger.error(loginPath + ' called');
      return next(null);
    },
    //	   passport.authenticate('session'),
    passport.authenticate('local', { failureRedirect: loginPath }),
    function (req: express.Request, res: express.Response, next: express.NextFunction) {

      function successReturnToOrRedirect() {
        if ((<any>req).session.returnTo) {
          logger.debug('redirecting to ', (<any>req).session.returnTo);
        }
        return res.redirect((<any>req).session.returnTo || '/');
      }

      logger.debug('passport.authenticate was successful');
      // Issue a remember me cookie if the option was checked
      if (!req.body.remember_me) {
        logger.debug('remember_me option was not checked');
        return successReturnToOrRedirect();
      }

      logger.debug('remember_me option was checked, issuing token');
      issueToken(req.user, function (err: Error, token: string) {
        if (err) { return next(err); }
        res.cookie('remember_me', token, { path: '/', httpOnly: true, maxAge: 604800000 }); // 7 days
        return successReturnToOrRedirect();
      });
    },
    function (req: express.Request, res: express.Response) {
      logger.error('Should never pass here');
      res.redirect('/');
    });

  app.get('/logout', function (req, res) {
    // clear the remember me cookie when logging out
    res.clearCookie('remember_me');
    req.logout();
    res.redirect('/');
  });
}

// Simple route middleware to ensure user is authenticated.
//   Use this route middleware on any resource that needs to be protected.  If
//   the request is authenticated (typically via a persistent login session),
//   the request will proceed.  Otherwise, the user will be redirected to the
//   login page.
export function ensureAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
  logger.debug('>> ensureAuthenticated');
  logger.debug('headers:', req.headers);
  if (logger.debug.toString() !== 'function (){}') {
    logger.debug('req.isAuthenticated():', req.isAuthenticated());
    logger.debug('req.session:', (<any>req).session);
  }
  ensureLogin.ensureLoggedIn(_loginPath)(req, res, function (err: Error): void {
    logger.debug('not redirected to login.html!');
    if (!req.isAuthenticated()) {
      logger.error('Assertion failed: user is NOT authenticated!');
      return;
    }
    return next(err);
  });
  logger.debug('<< ensureAuthenticated');
}

export function checkAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.isAuthenticated()) {
    return res.sendStatus(401);
  } else {
    return next(null);
  }
}

function consumeRememberMeToken(token: string, fn: (err: Error, value: string) => void) {
  logger.debug('consuming token!');
  // invalidate the single-use token
  // We do this asynchronously, to let all concurrent requests
  // still find the token.
  setTimeout(function () {
    _tokenMgr.deleteToken(token, function (err: Error) { });
  }, 5000);
  return _tokenMgr.getToken(token, fn);
}

function saveRememberMeToken(token: string, uid: User, fn: (err?: Error) => void) {
  return _tokenMgr.setToken(token, uid.id, function (err: Error) {
    return fn();
  });
}

function issueToken(user: User, done: (err: Error, token?: string) => void) {
  logger.debug('issuing token!');
  var token = _tokenMgr.createToken();
  saveRememberMeToken(token, user, function (err) {
    if (err) { return done(err); }
    return done(null, token);
  });
}
