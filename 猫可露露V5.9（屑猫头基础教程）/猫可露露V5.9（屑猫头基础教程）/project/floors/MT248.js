main.floors.MT248=
{
    "floorId": "MT248",
    "title": "248 层",
    "name": "248 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 100000,
    "defaultGround": 919,
    "bgm": "16.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,6": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,3": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
    [ 20,619,  0,  0,  0,620, 20,180205, 20,620,  0,619, 20],
    [ 20, 20, 20, 20, 20, 20, 20,641, 20, 20, 20, 20, 20],
    [ 20, 59, 81,572, 81,  0, 20,641, 20, 20, 20, 87, 20],
    [ 20,  0, 59, 20, 20,572, 20,544, 82,536,579,  0, 20],
    [ 20, 81, 20, 20, 20, 20, 20, 20, 20, 20, 20,637, 20],
    [ 20, 88,542,584,  0, 20, 20, 20,576, 20, 20, 83, 20],
    [ 20,  0, 20, 20,586,538,587, 20,619, 21, 20,576, 20],
    [ 20, 21, 20, 20, 60, 20,  0, 82, 21,  0,539,572, 20],
    [ 20, 82, 20, 20, 15, 20, 81, 20, 81, 20, 20,577, 20],
    [ 20,536,576, 21,537, 20,572, 20,536, 20, 20,532, 20],
    [ 20, 20, 21,180205, 20, 20, 20, 20,577,  0, 81, 22, 20],
    [ 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

],
    "weather": [
        "snow",
        2
    ]
}