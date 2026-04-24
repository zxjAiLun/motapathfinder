main.floors.MT361=
{
    "floorId": "MT361",
    "title": "361 层",
    "name": "361 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 5000000,
    "defaultGround": 305,
    "bgm": "21.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {
        "3,7": [
            "一段剧情。",
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        4
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        7,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        6
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        8
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        7,
                        9
                    ]
                ],
                "remove": true
            }
        ],
        "7,9": [
            "一段剧情。",
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        4
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        5,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        7,
                        5
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        6
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        6,
                        8
                    ]
                ],
                "remove": true
            },
            {
                "type": "hide",
                "loc": [
                    [
                        3,
                        7
                    ]
                ],
                "remove": true
            }
        ]
    },
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [178,1009,178,178,178,178,178,178,178,178,178,178,178],
    [178,178,178,1266,621, 82,1254, 22, 82,  0,178,587,178],
    [178,178,640,  0,178,178,178,1257,178,621,1258,  0,178],
    [178,646,  0,639,178,178,178,  0,178,178,178,1263,178],
    [178,178,178,178,178,178,1278,  0,178,178,178,732,178],
    [178,178,178,178,178,1275,  0,1280,  0,178,178, 82,178],
    [178,178,178,178,622,  0,1274,  0,622,1258,  0,635,178],
    [178,635, 86, 86,  0,622,  0,622,  0,178,645,  0,178],
    [178,1260,178,178,178,178,870,  0,178,178,178,178,178],
    [178,1009,178,178,178,178,178, 86,178,178,178,178,178],
    [178,  0,1256,620,178,178,178, 86,178,178,178,636,178],
    [178, 88,178,  0,1259, 82, 83,636,  0,620,1261, 87,178],
    [178,178,178,178,178,178,178,178,178,178,178,178,178]
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