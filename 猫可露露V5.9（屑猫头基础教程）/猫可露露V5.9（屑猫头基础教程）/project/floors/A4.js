main.floors.A4=
{
    "floorId": "A4",
    "title": "心境 A4",
    "name": "心境 A4",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": "ground",
    "bgm": "1.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "10,10": [
            {
                "type": "setCurtain",
                "color": [
                    255,
                    255,
                    255,
                    1
                ],
                "time": 1000,
                "keep": true
            },
            {
                "type": "win",
                "reason": "第一心境"
            }
        ]
    },
    "changeFloor": {
        "1,1": {
            "floorId": ":before",
            "stair": "upFloor"
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
    [  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2],
    [  2, 88,  0,  2, 28,209, 21,  0,  2, 34,  2, 27,  2],
    [  2,  0, 31, 82,  0,  2,  0, 31,210,  0,221,  0,  2],
    [  2,211,  2,  2,  2,  2,209,  2, 82,  2,  2, 81,  2],
    [  2, 86,  2,  0,212, 81, 32,  2, 28,  0, 81,214,  2],
    [  2,210,  2, 21,  2,  2,214,  2,  2,212,  2, 28,  2],
    [  2,  0,212,  0,  2,  0, 22,  2, 21,  0,  2,  0,  2],
    [  2, 27,  2, 34,  2, 31,  0, 81,  0, 32, 81, 32,  2],
    [  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2, 83,  2],
    [  2,  4,  4,  4,  4,  4,  4,  4,  2, 21,  0,215,  2],
    [  2,  4,  4,  4,  4,  4,  4,  4,  2,  0,904,  0,  2],
    [  2,  4,  4,  4,  4,  4,  4,  4,  2,578,  0, 21,  2],
    [  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}