main.floors.MT253=
{
    "floorId": "MT253",
    "title": "253 层",
    "name": "253 层",
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
        "10,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "2,9": {
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
    [ 20, 20, 20, 20, 20,180118, 20, 20, 20,572, 20, 20, 20],
    [ 20,585, 21,579, 82,584,547, 20, 20, 59, 20, 20, 20],
    [ 20,548, 20, 20, 20, 20, 22, 20, 20, 81, 20, 20, 20],
    [ 20,576,547, 20, 20,539,577,619,549,572, 20,572, 20],
    [ 20, 20, 21,  0,553,587, 20,551, 20,584, 81,  0, 20],
    [ 20, 20, 20, 81, 20, 20, 20, 15, 20, 20, 20, 59, 20],
    [ 20,586, 20,579, 20, 20, 20, 21, 81, 59, 20, 20, 20],
    [ 20,637,540,541, 16, 22,572,549, 20,572, 20, 20, 20],
    [ 20, 20, 87, 20, 20, 81, 20, 20, 20, 20, 20, 20, 20],
    [ 20, 20, 20, 20,576, 58, 20, 20, 20, 60, 20, 20, 20],
    [ 20, 20, 20, 20, 58,546, 47, 59, 82,  0, 88, 20, 20],
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