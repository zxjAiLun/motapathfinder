main.floors.C5=
{
    "floorId": "C5",
    "title": "心境 C5",
    "name": "心境 C5",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 15000,
    "defaultGround": 972,
    "bgm": "13.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,1": [
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
                "type": "if",
                "condition": "(flag:xun==0)",
                "true": [
                    {
                        "type": "win",
                        "reason": "第三心境"
                    }
                ],
                "false": [
                    {
                        "type": "setValue",
                        "name": "status:hp",
                        "operator": "/=",
                        "value": "flag:xun"
                    },
                    {
                        "type": "win",
                        "reason": "第三心境"
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "1,7": {
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
    [142,142,142,142,142,142,142,142,142,142,142,142,142],
    [142,191816,191817,  4, 15, 15,992, 82, 82,  4,191816,191817,142],
    [142,191824,191825,619,  4, 86, 86, 86,  4,619,191824,191825,142],
    [142,572,142, 83,142,  4,  4,493,142, 83,142,572,142],
    [142, 81,637,484,  0, 21,142,  0, 81, 60,142, 81,142],
    [142, 21,  0,142, 50,  0,489, 21,142,579, 81, 21,142],
    [142, 82,142,142, 22, 82,142,142,142,483,142,572,142],
    [142, 87,142,142,142,579,484,  0,142,  0,142,  0,142],
    [142,  0, 21,487, 86,488,142,572,483, 21,484,577,142],
    [142,142,472,142,142,142,142,142,142, 81,142,142,142],
    [142, 60,  0,142,577, 59,  0, 82,576,  0,142,142,142],
    [142,  0,586, 82,  0,577, 59,142,  0,579,483, 88,142],
    [142,142,142,142,142,142,142,142,142,142,142,142,142]
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