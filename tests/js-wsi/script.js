


document.addEventListener('DOMContentLoaded', function() {

    wsi.init({
        debug: true,
        host: 'localhost:8080',
        path: '/wsi',
        query: {
            user: 10,
            token: '123'
        },
        mode: "http",
        onconnect: function(err) {
            if (err) console.log(err);
            else console.log('connected');
        }
    });

    var def = wsi.Def;
    var qry = wsi.Qry;

    def.tests().test2 = function(_) {
        return { message: "yeah, ok here too!" };
    }

    def.tests()._ = {
        test3: {
            "@": ["arg1"],
            _: function(_) {
                console.log("passthrough@tests.test3", _);
                _.whatever = 3;
            },
            t31: function(_) {
                console.log('call@tests.test3.t31', _);
                return {message: 'OKE'};
            }
        }
    };

    def.tests().loop("count").$ = (_, cb) => {
        console.log(_);
        cb({count: _.count});
        setTimeout(function(_) {
            qry().tests().loop(_.count).$(function(err, res) {
                if (err) {
                    console.log("loop error. stopping", err);
                    return;
                }
                console.log("looped", res);
            });
        }, 1000, _);
    }
});
