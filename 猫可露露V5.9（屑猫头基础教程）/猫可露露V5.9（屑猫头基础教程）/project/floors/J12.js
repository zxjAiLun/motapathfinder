main.floors.J12=
{
    "floorId": "J12",
    "title": "心境 J12",
    "name": "心境 J12",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "12.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 20000000000,
    "defaultGround": 906,
    "bgm": "32.mp3",
    "weather": [
        "sun",
        3
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,1": [
            {
                "type": "animate",
                "name": "jingya",
                "loc": [
                    6,
                    2
                ]
            },
            {
                "type": "jump",
                "to": [
                    6,
                    0
                ],
                "time": 500,
                "keep": true
            },
            {
                "type": "animate",
                "name": "xue",
                "loc": [
                    6,
                    1
                ]
            },
            {
                "type": "setBlock",
                "number": "E1606",
                "loc": [
                    [
                        6,
                        1
                    ]
                ]
            },
            {
                "type": "setEnemyOnPoint",
                "loc": [
                    [
                        6,
                        1
                    ]
                ],
                "name": "hp",
                "operator": "*=",
                "value": "1.66"
            },
            {
                "type": "setEnemyOnPoint",
                "loc": [
                    [
                        6,
                        1
                    ]
                ],
                "name": "atk",
                "operator": "*=",
                "value": "1.25"
            }
        ],
        "6,0": [
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
                        "reason": "第十心境"
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
                        "reason": "第十心境"
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "3,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "5,5": [
            {
                "type": "setValue",
                "name": "flag:door_J12_6_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,5": [
            {
                "type": "setValue",
                "name": "flag:door_J12_6_4",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,4": {
            "0": {
                "condition": "flag:door_J12_6_4==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_J12_6_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  4,  4,  4,  4,197,410384,410385,410386,197,  4,  4,  4,  4],
    [  4,1018,1582,  4,644,410380,999,410380,644,  4,1602,646,  4],
    [  4,  4, 22, 81, 21,410388,1582,410388, 21,1582, 22,  4,  4],
    [  4,1013,1602,  4,1015,1601,1012,1605,1011,  4,1016,410421,  4],
    [  4,  4,  4,  4,197,197, 85,197,197,  4,  4,  4,  4],
    [197,1437,197, 21,197,1582,  0,1582, 21,  0,197,638,197],
    [197,  0,1600,  0,197,197, 23, 81,  0,1584,1015,1600,197],
    [197,197,197, 81,197,197,1598,197, 82,197,1585,197,197],
    [197,410342,197,1015,197, 21,  0,197,1009,1598, 22,  0,197],
    [197,642,197,1585,1437,197,1585,197,1601,197,197,1600,197],
    [197,1584, 83,  0,197,  0,639,197,1010, 82,643,  0,197],
    [197,640,197, 88,197,640,  0,1601,  0,197,  0,410422,197],
    [197,197,197,197,197,197,197,197,197,197,197,197,197]
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