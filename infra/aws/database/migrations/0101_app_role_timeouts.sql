-- Round DB: time limits for the application role (the web task and the workers connect as sea_n_shore_app). A runaway
-- statement stops after 10 seconds, and a session left idle inside an open transaction is ended after 60 seconds, so
-- neither can hold locks or a connection indefinitely. Role settings apply to new connections; the pool picks them up
-- as connections are replaced (every deploy replaces them all). The migration runner's plan run lists the app role's
-- slowest statements first, so the limits are only applied when nothing the app runs routinely comes near them.
-- Reversible: alter role sea_n_shore_app reset statement_timeout; alter role sea_n_shore_app reset
-- idle_in_transaction_session_timeout.
-- statement-breakpoint
alter role sea_n_shore_app set statement_timeout = '10s';
-- statement-breakpoint
alter role sea_n_shore_app set idle_in_transaction_session_timeout = '60s';
